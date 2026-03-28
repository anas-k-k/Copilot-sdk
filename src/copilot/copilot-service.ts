import { promises as fs } from "node:fs";
import path from "node:path";

import { CopilotClient, approveAll } from "@github/copilot-sdk";

import type { AppConfig } from "../config/env.js";
import type { FileSearchService } from "../files/file-search-service.js";
import type { GoogleWorkspaceService } from "../google-workspace/google-workspace-service.js";
import type { HomeMateService } from "../homemate/homemate-service.js";
import type { Logger } from "../logging/logger.js";
import type { HomeMateActionRegistry } from "../state/homemate-action-registry.js";
import type { OutboundFileRegistry } from "../state/outbound-file-registry.js";
import { SessionRegistry } from "../state/session-registry.js";
import type { SkillInstallRegistry } from "../state/skill-install-registry.js";
import type { WebcamCaptureService } from "../webcam/webcam-capture-service.js";
import type { WebcamVideoService } from "../webcam/webcam-video-service.js";
import type { SkillService } from "../skills/skill-service.js";
import { type CopilotAgentRole, getCopilotSessionKey } from "./agent-role.js";
import { buildTelegramSystemPrompt } from "./prompt.js";
import { CopilotToolRegistry } from "./tool-registry.js";

type CopilotSessionHandle = Awaited<ReturnType<CopilotClient["createSession"]>>;

export class CopilotService {
  private readonly client: CopilotClient;
  private readonly sessions = new SessionRegistry<CopilotSessionHandle>();
  private readonly toolRegistry: CopilotToolRegistry;

  public constructor(
    private readonly config: AppConfig,
    private readonly logger: Logger,
    private readonly skillService: SkillService,
    private readonly installRegistry: SkillInstallRegistry,
    private readonly googleWorkspaceService: GoogleWorkspaceService,
    private readonly homeMateService: HomeMateService,
    private readonly homeMateActionRegistry: HomeMateActionRegistry,
    private readonly fileSearchService: FileSearchService,
    private readonly outboundFileRegistry: OutboundFileRegistry,
    private readonly webcamCaptureService: WebcamCaptureService,
    private readonly webcamVideoService: WebcamVideoService,
  ) {
    this.client = new CopilotClient({
      cliPath: this.config.copilotCliPath,
      logLevel: this.config.copilotLogLevel,
    });
    this.toolRegistry = new CopilotToolRegistry({
      skillService: this.skillService,
      installRegistry: this.installRegistry,
      googleWorkspaceService: this.googleWorkspaceService,
      homeMateService: this.homeMateService,
      homeMateActionRegistry: this.homeMateActionRegistry,
      fileSearchService: this.fileSearchService,
      outboundFileRegistry: this.outboundFileRegistry,
      webcamCaptureService: this.webcamCaptureService,
      webcamVideoService: this.webcamVideoService,
    });
  }

  public async start(): Promise<void> {
    await this.client.start();
  }

  public async stop(): Promise<void> {
    for (const sessionKey of this.sessions.keys()) {
      const session = this.sessions.get(sessionKey);
      if (!session) {
        continue;
      }

      await session.disconnect();
      this.sessions.delete(sessionKey);
    }

    await this.client.stop();
  }

  public async resetSession(
    userId: string,
    role: CopilotAgentRole = "primary",
  ): Promise<void> {
    const session = this.sessions.get(getCopilotSessionKey(userId, role));
    if (!session) {
      return;
    }

    await session.disconnect();
    this.sessions.delete(getCopilotSessionKey(userId, role));
  }

  public async invalidateSession(
    userId: string,
    role: CopilotAgentRole = "primary",
  ): Promise<void> {
    await this.resetSession(userId, role);
  }

  public async invalidateUserSessions(userId: string): Promise<void> {
    const sessionKeys = this.sessions
      .keys()
      .filter((key) => key.startsWith(`${userId}:`));

    for (const sessionKey of sessionKeys) {
      const session = this.sessions.get(sessionKey);
      if (!session) {
        continue;
      }

      await session.disconnect();
      this.sessions.delete(sessionKey);
    }
  }

  public async sendPrompt(
    userId: string,
    prompt: string,
    role: CopilotAgentRole = "primary",
  ): Promise<string> {
    const timeoutMs =
      role === "primary"
        ? this.config.copilotRequestTimeoutMs
        : this.config.copilotDelegatedRequestTimeoutMs;

    try {
      const session = await this.getOrCreateSession(userId, role);
      const response = await session.sendAndWait({ prompt }, timeoutMs);
      return (
        response?.data.content?.trim() ||
        "I finished that step, but I did not receive a text reply."
      );
    } catch (error) {
      this.logger.warn(
        "Copilot session failed, retrying with a fresh session",
        {
          userId,
          role,
          error: error instanceof Error ? error.message : String(error),
        },
      );

      await this.invalidateSession(userId, role);
      const session = await this.getOrCreateSession(userId, role);
      try {
        const response = await session.sendAndWait({ prompt }, timeoutMs);
        return (
          response?.data.content?.trim() ||
          "I finished that step, but I did not receive a text reply."
        );
      } catch (retryError) {
        this.logger.error("Copilot session failed after retry", {
          userId,
          role,
          error:
            retryError instanceof Error
              ? retryError.message
              : String(retryError),
        });

        if (isIdleTimeoutError(retryError)) {
          return role === "primary"
            ? "That request took too long to finish. Please try a narrower scope, such as an exact file name, smaller Gmail query, or one specific task."
            : "The delegated task took too long to finish. Please retry with a narrower scope or a more specific target.";
        }

        throw retryError;
      }
    }
  }

  private async getOrCreateSession(
    userId: string,
    role: CopilotAgentRole,
  ): Promise<CopilotSessionHandle> {
    const sessionKey = getCopilotSessionKey(userId, role);
    const existing = this.sessions.get(sessionKey);
    if (existing) {
      return existing;
    }

    await this.skillService.ensureUserWorkspace(userId);
    await fs.mkdir(this.skillService.getInstalledSkillDirectory(userId), {
      recursive: true,
    });
    const bundledSkillDirectories = await this.getBundledSkillDirectories();

    const session = await this.client.createSession({
      model: this.config.copilotModel,
      onPermissionRequest: approveAll,
      skillDirectories: [
        this.skillService.getInstalledSkillDirectory(userId),
        ...bundledSkillDirectories,
      ],
      systemMessage: {
        content: buildTelegramSystemPrompt(role),
      },
      tools: this.toolRegistry.createTools(userId, role),
    });

    this.sessions.set(sessionKey, session);
    return session;
  }

  private async getBundledSkillDirectories(): Promise<string[]> {
    const bundledSkillRoot = path.resolve(process.cwd(), "local-skills");

    try {
      const entries = await fs.readdir(bundledSkillRoot, {
        withFileTypes: true,
      });
      return entries
        .filter((entry) => entry.isDirectory())
        .map((entry) => path.join(bundledSkillRoot, entry.name));
    } catch {
      return [];
    }
  }
}

function isIdleTimeoutError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  return /session\.idle|timeout after/i.test(error.message);
}
