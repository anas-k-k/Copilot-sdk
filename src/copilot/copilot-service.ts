import { promises as fs } from "node:fs";
import path from "node:path";

import { CopilotClient, approveAll, defineTool } from "@github/copilot-sdk";
import { z } from "zod";

import type { AppConfig } from "../config/env.js";
import type { FileSearchService } from "../files/file-search-service.js";
import type { GoogleWorkspaceService } from "../google-workspace/google-workspace-service.js";
import type { Logger } from "../logging/logger.js";
import type { OutboundFileRegistry } from "../state/outbound-file-registry.js";
import { SessionRegistry } from "../state/session-registry.js";
import type { SkillInstallRegistry } from "../state/skill-install-registry.js";
import type { SkillService } from "../skills/skill-service.js";
import { buildTelegramSystemPrompt } from "./prompt.js";

type CopilotSessionHandle = Awaited<ReturnType<CopilotClient["createSession"]>>;

export class CopilotService {
  private readonly client: CopilotClient;
  private readonly sessions = new SessionRegistry<CopilotSessionHandle>();

  public constructor(
    private readonly config: AppConfig,
    private readonly logger: Logger,
    private readonly skillService: SkillService,
    private readonly installRegistry: SkillInstallRegistry,
    private readonly googleWorkspaceService: GoogleWorkspaceService,
    private readonly fileSearchService: FileSearchService,
    private readonly outboundFileRegistry: OutboundFileRegistry,
  ) {
    this.client = new CopilotClient({
      cliPath: this.config.copilotCliPath,
      logLevel: this.config.copilotLogLevel,
    });
  }

  public async start(): Promise<void> {
    await this.client.start();
  }

  public async stop(): Promise<void> {
    for (const userId of this.sessions.keys()) {
      await this.resetSession(userId);
    }

    await this.client.stop();
  }

  public async resetSession(userId: string): Promise<void> {
    const session = this.sessions.get(userId);
    if (!session) {
      return;
    }

    await session.disconnect();
    this.sessions.delete(userId);
  }

  public async invalidateSession(userId: string): Promise<void> {
    await this.resetSession(userId);
  }

  public async sendPrompt(userId: string, prompt: string): Promise<string> {
    try {
      const session = await this.getOrCreateSession(userId);
      const response = await session.sendAndWait({ prompt }, 180_000);
      return (
        response?.data.content?.trim() ||
        "I finished that step, but I did not receive a text reply."
      );
    } catch (error) {
      this.logger.warn(
        "Copilot session failed, retrying with a fresh session",
        {
          userId,
          error: error instanceof Error ? error.message : String(error),
        },
      );

      await this.invalidateSession(userId);
      const session = await this.getOrCreateSession(userId);
      try {
        const response = await session.sendAndWait({ prompt }, 180_000);
        return (
          response?.data.content?.trim() ||
          "I finished that step, but I did not receive a text reply."
        );
      } catch (retryError) {
        this.logger.error("Copilot session failed after retry", {
          userId,
          error:
            retryError instanceof Error
              ? retryError.message
              : String(retryError),
        });

        if (isIdleTimeoutError(retryError)) {
          return "That request took too long to finish. Please try a narrower file description like the exact document name, folder, or extension.";
        }

        throw retryError;
      }
    }
  }

  private async getOrCreateSession(
    userId: string,
  ): Promise<CopilotSessionHandle> {
    const existing = this.sessions.get(userId);
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
        content: buildTelegramSystemPrompt(),
      },
      tools: [
        defineTool("search_skill_registry", {
          description:
            "Search the skills registry for relevant reusable skills.",
          parameters: z.object({
            query: z
              .string()
              .min(1)
              .describe("Search phrase describing the user's goal."),
          }),
          handler: async ({ query }) => this.skillService.searchSkills(query),
        }),
        defineTool("list_user_skills", {
          description: "List skills already installed for this Telegram user.",
          parameters: z.object({}),
          handler: async () => this.skillService.listInstalledSkills(userId),
        }),
        defineTool("queue_skill_install", {
          description:
            "Queue a skill installation request that still needs explicit user confirmation.",
          parameters: z.object({
            source: z
              .string()
              .min(1)
              .describe("Skill source like owner/repo or a git URL."),
            skills: z
              .array(z.string().min(1))
              .optional()
              .describe("Specific skill names to install."),
            reason: z
              .string()
              .min(1)
              .describe("Why this skill helps with the task."),
            goal: z
              .string()
              .min(1)
              .describe(
                "Short summary of the user's task to continue after install.",
              ),
          }),
          handler: async ({ source, skills, reason, goal }) => {
            const pending = this.installRegistry.stage(userId, {
              source,
              requestedSkills: skills ?? [],
              reason,
              goal,
            });

            return {
              queued: true,
              requestId: pending.id,
              source: pending.source,
              requestedSkills: pending.requestedSkills,
              reason: pending.reason,
              confirmationMessage:
                "A pending skill install has been created. Ask the user to reply YES to confirm or NO to cancel.",
            };
          },
        }),
        defineTool("gmail_connection_status", {
          description:
            "Check whether Gmail is available through the configured Google Workspace CLI.",
          parameters: z.object({}),
          handler: async () =>
            safeToolResult(() =>
              this.googleWorkspaceService.getGmailConnectionStatus(),
            ),
        }),
        defineTool("gmail_list_messages", {
          description:
            "List Gmail messages through the configured Google Workspace CLI.",
          parameters: z.object({
            query: z
              .string()
              .optional()
              .describe(
                "Optional Gmail search query, for example is:unread newer_than:7d.",
              ),
            maxResults: z
              .number()
              .int()
              .min(1)
              .max(25)
              .optional()
              .describe("Maximum number of messages to return."),
          }),
          handler: async ({ query, maxResults }) => {
            const request = {
              ...(query ? { query } : {}),
              ...(maxResults !== undefined ? { maxResults } : {}),
            };

            return safeToolResult(() =>
              this.googleWorkspaceService.listGmailMessages(request),
            );
          },
        }),
        defineTool("gmail_read_message", {
          description:
            "Read a Gmail message by id through the configured Google Workspace CLI.",
          parameters: z.object({
            messageId: z.string().min(1).describe("The Gmail message id."),
          }),
          handler: async ({ messageId }) =>
            safeToolResult(() =>
              this.googleWorkspaceService.readGmailMessage(messageId),
            ),
        }),
        defineTool("gmail_send_message", {
          description:
            "Send a Gmail message through the configured Google Workspace CLI.",
          parameters: z.object({
            to: z
              .array(z.string().email())
              .min(1)
              .describe("Recipient email addresses."),
            subject: z.string().min(1).describe("Email subject."),
            body: z.string().min(1).describe("Plain text email body."),
            cc: z
              .array(z.string().email())
              .optional()
              .describe("Optional CC email addresses."),
            bcc: z
              .array(z.string().email())
              .optional()
              .describe("Optional BCC email addresses."),
          }),
          handler: async ({ to, subject, body, cc, bcc }) => {
            const request = {
              to,
              subject,
              body,
              ...(cc ? { cc } : {}),
              ...(bcc ? { bcc } : {}),
            };

            return safeToolResult(() =>
              this.googleWorkspaceService.sendGmailMessage(request),
            );
          },
        }),
        defineTool("search_local_files", {
          description:
            "Search the local machine for files that match a natural-language request using file names, paths, and supported document text.",
          parameters: z.object({
            query: z
              .string()
              .min(1)
              .describe(
                "Natural-language file request such as 'my adhar card image or doc'.",
              ),
          }),
          handler: async ({ query }) =>
            safeToolResult(() => this.fileSearchService.searchFiles(query)),
        }),
        defineTool("queue_telegram_file_send", {
          description:
            "Queue a local file to be sent back to the Telegram user after the assistant finishes responding.",
          parameters: z.object({
            filePath: z
              .string()
              .min(1)
              .describe(
                "Absolute file path of the specific file the user selected.",
              ),
            caption: z
              .string()
              .max(500)
              .optional()
              .describe(
                "Optional short caption to accompany the Telegram file.",
              ),
          }),
          handler: async ({ filePath, caption }) =>
            safeToolResult(async () => {
              const file =
                await this.fileSearchService.getSendableFile(filePath);
              this.outboundFileRegistry.stage(userId, {
                filePath: file.absolutePath,
                ...(caption ? { caption } : {}),
              });

              return {
                queued: true,
                filePath: file.absolutePath,
                fileName: file.fileName,
                sizeBytes: file.sizeBytes,
              };
            }),
        }),
      ],
    });

    this.sessions.set(userId, session);
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

async function safeToolResult<T>(
  action: () => Promise<T>,
): Promise<T | { ok: false; error: string }> {
  try {
    return await action();
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
