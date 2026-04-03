import { promises as fs } from "node:fs";
import type { CopilotService } from "../copilot/copilot-service.js";
import type { GoogleWorkspaceService } from "../google-workspace/google-workspace-service.js";
import type { HomeMateService } from "../homemate/homemate-service.js";
import type { Logger } from "../logging/logger.js";
import type { PendingHomeMateBulkSwitchAction } from "../state/homemate-action-registry.js";
import type { HomeMateActionRegistry } from "../state/homemate-action-registry.js";
import {
  MessageQueue,
  MessageQueueTimeoutError,
} from "../state/message-queue.js";
import type {
  OutboundFileRegistry,
  PendingOutboundFile,
} from "../state/outbound-file-registry.js";
import type { SkillInstallRegistry } from "../state/skill-install-registry.js";
import type { DelegatedJobDispatcher } from "../subagents/job-dispatcher.js";
import type { SkillService } from "../skills/skill-service.js";
import type { WebcamVideoService } from "../webcam/webcam-video-service.js";
import type {
  PendingSkillInstallRequest,
  SkillInstallResult,
  SkillSearchResult,
} from "../skills/types.js";
import { isAffirmative, isNegative, isStopCommand } from "../utils/text.js";
import { TelegramApiError } from "./telegram-client.js";
import { normalizeTelegramUpdate } from "./update-normalizer.js";
import type { NormalizedTelegramUpdate } from "./types.js";
import type { TelegramClient } from "./telegram-client.js";
import type { OllamaProvider } from "../providers/ollama-provider.js";
import { MODELS, findModel } from "../providers/models.js";
import { createSession, resetSession } from "../state/chat-session.js";
import type { ChatSession } from "../state/chat-session.js";

const telegramTypingRefreshIntervalMs = 4_000;

interface SkillInstallJobResult {
  result: SkillInstallResult;
  continuation: string;
  pendingFiles: PendingOutboundFile[];
}

export class TelegramBot {
  private readonly messageQueue: MessageQueue;
  private readonly ollamaProvider: OllamaProvider;
  private readonly chatSessions = new Map<string, ChatSession>();
  private offset: number | undefined;
  private stopped = false;

  public constructor(
    private readonly telegramClient: TelegramClient,
    private readonly copilotService: CopilotService,
    private readonly skillService: SkillService,
    private readonly installRegistry: SkillInstallRegistry,
    private readonly googleWorkspaceService: GoogleWorkspaceService,
    private readonly homeMateService: HomeMateService,
    private readonly homeMateActionRegistry: HomeMateActionRegistry,
    private readonly outboundFileRegistry: OutboundFileRegistry,
    private readonly delegatedJobDispatcher: DelegatedJobDispatcher,
    private readonly webcamVideoService: WebcamVideoService,
    private readonly logger: Logger,
    private readonly allowedTelegramUserIds: ReadonlySet<string> = new Set(),
    messageQueueTimeoutMs = 300_000,
    ollamaProvider?: OllamaProvider,
  ) {
    this.messageQueue = new MessageQueue(messageQueueTimeoutMs);
    this.ollamaProvider = ollamaProvider as OllamaProvider;
  }

  public async start(): Promise<void> {
    await this.preparePolling();
    this.logger.info("Telegram polling started");

    while (!this.stopped) {
      try {
        const updates = await this.telegramClient.getUpdates(this.offset);

        for (const update of updates) {
          this.offset = update.update_id + 1;
          const normalized = normalizeTelegramUpdate(update);
          if (!normalized) {
            continue;
          }

          if (
            this.allowedTelegramUserIds.size > 0 &&
            !this.allowedTelegramUserIds.has(normalized.userId)
          ) {
            this.logger.warn(
              "Ignoring Telegram message from unauthorized user",
              {
                userId: normalized.userId,
                username: normalized.username,
                chatId: normalized.chatId,
                text: normalized.text,
              },
            );
            continue;
          }

          void this.messageQueue
            .enqueue(normalized.userId, async () => {
              await this.processUpdate(normalized);
            })
            .catch(async (error) => {
              this.logger.error("Telegram update processing failed", {
                updateId: normalized.updateId,
                userId: normalized.userId,
                chatId: normalized.chatId,
                error: error instanceof Error ? error.message : String(error),
              });

              if (error instanceof MessageQueueTimeoutError) {
                await this.telegramClient.sendMessage(
                  normalized.chatId,
                  "That task is still running longer than expected, so I released your queue. You can keep chatting, or retry with a narrower scope.",
                  normalized.messageId,
                );
              } else if (normalized.commandName) {
                await this.telegramClient.sendMessage(
                  normalized.chatId,
                  `Command failed: ${error instanceof Error ? error.message : String(error)}`,
                  normalized.messageId,
                );
              }
            });
        }
      } catch (error) {
        if (isGetUpdatesConflict(error)) {
          this.logger.error(
            "Telegram polling conflict detected; stopping polling",
            {
              error: error.message,
            },
          );
          this.stop();
          continue;
        }

        this.logger.error("Polling loop failed", {
          error: error instanceof Error ? error.message : String(error),
        });

        await delay(2000);
      }
    }
  }

  public stop(): void {
    this.stopped = true;
  }

  private async preparePolling(): Promise<void> {
    try {
      await this.telegramClient.deleteWebhook();
    } catch (error) {
      this.logger.warn("Failed to clear Telegram webhook before polling", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private async processUpdate(update: NormalizedTelegramUpdate): Promise<void> {
    this.logger.info("Processing Telegram message", {
      userId: update.userId,
      chatId: update.chatId,
      commandName: update.commandName,
    });

    await this.runWithTypingIndicator(update.chatId, async () => {
      if (update.commandName) {
        await this.handleCommand(update);
        return;
      }

      const pendingHomeMateAction =
        this.homeMateActionRegistry.getPendingBulkSwitchAction(update.userId);
      if (pendingHomeMateAction) {
        const handled = await this.handlePendingHomeMateBulkAction(
          update,
          pendingHomeMateAction,
        );
        if (handled) {
          return;
        }
      }

      const pending = this.installRegistry.getPending(update.userId);
      if (pending) {
        const handled = await this.handlePendingConfirmation(update, pending);
        if (handled) {
          return;
        }
      }

      if (
        this.webcamVideoService.hasActiveRecording(update.userId) &&
        isStopCommand(update.text)
      ) {
        await this.handleVideoRecordingStop(update);
        return;
      }

      const session = this.getOrCreateSession(update.userId);
      const model = findModel(session.selectedModelId);
      let response: string;

      if (!model || model.backend === "ollama") {
        const result = await this.ollamaProvider.chat(
          update.text,
          update.userId,
          session.ollamaHistory,
        );
        response = result.response;
        session.ollamaHistory = result.updatedHistory;
      } else {
        response = await this.copilotService.sendPrompt(update.userId, update.text);
      }

      await this.telegramClient.sendMessage(
        update.chatId,
        response,
        update.messageId,
      );
      await this.flushPendingFiles(
        update.userId,
        update.chatId,
        update.messageId,
      );
    });
  }

  private async runWithTypingIndicator<T>(
    chatId: number,
    action: () => Promise<T>,
  ): Promise<T> {
    let stopped = false;
    let releaseDelay: (() => void) | undefined;

    const typingLoop = (async () => {
      while (!stopped) {
        try {
          await this.telegramClient.sendTypingAction(chatId);
        } catch (error) {
          this.logger.warn("Failed to send Telegram typing action", {
            chatId,
            error: error instanceof Error ? error.message : String(error),
          });
        }

        if (stopped) {
          return;
        }

        await new Promise<void>((resolve) => {
          releaseDelay = resolve;
          setTimeout(resolve, telegramTypingRefreshIntervalMs);
        });
        releaseDelay = undefined;
      }
    })();

    try {
      return await action();
    } finally {
      stopped = true;
      releaseDelay?.();
      await typingLoop;
    }
  }

  private async handleCommand(update: NormalizedTelegramUpdate): Promise<void> {
    switch (update.commandName) {
      case "start":
      case "help":
        await this.telegramClient.sendMessage(
          update.chatId,
          [
            "I can chat through Copilot or Gemma 4 (local), search skills, install skills after confirmation, control configured HomeMate switches, send a live webcam photo, and record live webcam video when you ask for one.",
            "",
            "Commands:",
            "/help - show this help",
            "/new - start a fresh session and choose a model",
            "/reset - start a fresh session and choose a model",
            "/skills - list your installed skills",
            "/searchskill <query> - search for relevant skills",
            "/installskill <source> [skill1,skill2] - queue a skill install",
            "/gmailstatus - check Gmail CLI connectivity",
            "/gmaillist [query] - list recent Gmail messages",
            "/gmailread <messageId> - read one Gmail message",
            "",
            "HomeMate is also available in natural language, for example:",
            "- list my smart switches",
            "- turn kitchen switch on",
            "- turn all switches off",
            "- send a live photo from my webcam",
            "- record a live video from my webcam (say stop to end)",
          ].join("\n"),
          update.messageId,
        );
        return;

      case "reset":
      case "new":
        this.installRegistry.clearPending(update.userId);
        await this.copilotService.invalidateUserSessions(update.userId);
        this.resetUserSession(update.userId);
        await this.sendModelPicker(update.chatId);
        return;

      case "skills": {
        const skills = await this.skillService.listInstalledSkills(
          update.userId,
        );
        const text =
          skills.length === 0
            ? "You do not have any installed skills yet."
            : [
                "Installed skills:",
                ...skills.map(
                  (skill) => `- ${skill.name}: ${skill.description}`,
                ),
              ].join("\n");
        this.installRegistry.rememberInstalled(update.userId, skills);
        await this.telegramClient.sendMessage(
          update.chatId,
          text,
          update.messageId,
        );
        return;
      }

      case "searchskill": {
        const query = update.commandArgs?.trim();
        if (!query) {
          await this.telegramClient.sendMessage(
            update.chatId,
            "Usage: /searchskill <query>",
            update.messageId,
          );
          return;
        }

        const results = await this.skillService.searchSkills(query);
        await this.telegramClient.sendMessage(
          update.chatId,
          formatSkillSearch(results),
          update.messageId,
        );
        return;
      }

      case "installskill": {
        const args = update.commandArgs?.trim();
        if (!args) {
          await this.telegramClient.sendMessage(
            update.chatId,
            "Usage: /installskill <source> [skill1,skill2]",
            update.messageId,
          );
          return;
        }

        const [sourceCandidate, ...rest] = args.split(/\s+/);
        const source = sourceCandidate?.trim();
        if (!source) {
          await this.telegramClient.sendMessage(
            update.chatId,
            "Usage: /installskill <source> [skill1,skill2]",
            update.messageId,
          );
          return;
        }

        const requestedSkills = rest
          .join(" ")
          .split(",")
          .map((value) => value.trim())
          .filter(Boolean);
        const pending = this.installRegistry.stage(update.userId, {
          source,
          requestedSkills,
          reason: "User requested an explicit skill install from Telegram.",
          goal: `Use the installed skill from source ${source} to continue helping the user.`,
        });

        await this.telegramClient.sendMessage(
          update.chatId,
          formatPendingInstall(pending),
          update.messageId,
        );
        return;
      }

      case "gmailstatus": {
        const status =
          await this.googleWorkspaceService.getGmailConnectionStatus();
        await this.telegramClient.sendMessage(
          update.chatId,
          formatGmailStatus(status),
          update.messageId,
        );
        return;
      }

      case "gmaillist": {
        try {
          const query = update.commandArgs?.trim();
          const result = await this.googleWorkspaceService.listGmailMessages({
            maxResults: 10,
            ...(query ? { query } : {}),
          });
          await this.telegramClient.sendMessage(
            update.chatId,
            formatGmailList(result),
            update.messageId,
          );
        } catch (error) {
          await this.telegramClient.sendMessage(
            update.chatId,
            `Gmail list failed: ${error instanceof Error ? error.message : String(error)}`,
            update.messageId,
          );
        }
        return;
      }

      case "gmailread": {
        const messageId = update.commandArgs?.trim();
        if (!messageId) {
          await this.telegramClient.sendMessage(
            update.chatId,
            "Usage: /gmailread <messageId>",
            update.messageId,
          );
          return;
        }

        try {
          const message =
            await this.googleWorkspaceService.readGmailMessage(messageId);
          await this.telegramClient.sendMessage(
            update.chatId,
            formatGmailMessage(message),
            update.messageId,
          );
        } catch (error) {
          await this.telegramClient.sendMessage(
            update.chatId,
            `Gmail read failed: ${error instanceof Error ? error.message : String(error)}`,
            update.messageId,
          );
        }
        return;
      }

      case "set_model": {
        if (update.callbackQueryId) {
          await this.telegramClient.answerCallbackQuery(update.callbackQueryId);
        }
        const modelId = update.commandArgs;
        const model = modelId ? findModel(modelId) : undefined;
        if (model) {
          const session = this.getOrCreateSession(update.userId);
          session.selectedModelId = modelId!;
          await this.telegramClient.sendMessage(
            update.chatId,
            `✅ Model set to *${model.label}*. Send your first message to start!`,
          );
        }
        return;
      }

      default:
        await this.telegramClient.sendMessage(
          update.chatId,
          "Unknown command. Try /help.",
          update.messageId,
        );
    }
  }

  private async handlePendingConfirmation(
    update: NormalizedTelegramUpdate,
    pending: PendingSkillInstallRequest,
  ): Promise<boolean> {
    if (isNegative(update.text)) {
      this.installRegistry.clearPending(update.userId);
      await this.telegramClient.sendMessage(
        update.chatId,
        "Cancelled the pending skill install.",
        update.messageId,
      );
      return true;
    }

    if (!isAffirmative(update.text)) {
      return false;
    }

    await this.telegramClient.sendMessage(
      update.chatId,
      "Installing the requested skill in the background now. I'll send a follow-up when it finishes.",
      update.messageId,
    );
    const job = this.delegatedJobDispatcher.dispatch<SkillInstallJobResult>(
      {
        kind: "skill-install",
        userId: update.userId,
        role: "skill-installer",
        summary: `Install skills from ${pending.source}`,
      },
      async () => {
        const result = await this.skillService.installSkills(
          update.userId,
          pending,
        );
        this.installRegistry.rememberInstalled(
          update.userId,
          result.installedSkills,
        );
        await this.copilotService.invalidateUserSessions(update.userId);

        const continuation = await this.copilotService.sendPrompt(
          update.userId,
          [
            `The requested skills from ${pending.source} are now installed for this user.`,
            pending.requestedSkills.length > 0
              ? `Installed skill names: ${pending.requestedSkills.join(", ")}.`
              : "Use any newly available installed skill if it helps.",
            `Continue helping with this goal: ${pending.goal}`,
          ].join(" "),
          "skill-installer",
        );

        return {
          result,
          continuation,
          pendingFiles: this.outboundFileRegistry.drain(update.userId),
        };
      },
    );

    this.installRegistry.clearPending(update.userId);
    await this.telegramClient.sendMessage(
      update.chatId,
      `Background job started: ${job.id}`,
      update.messageId,
    );

    void job.completion
      .then(async ({ result, continuation, pendingFiles }) => {
        const installedSummary =
          result.installedSkills.length === 0
            ? `Install command completed for ${pending.source}, but no new skill directories were detected.`
            : `Installed skill${result.installedSkills.length === 1 ? "" : "s"}: ${result.installedSkills
                .map((skill) => skill.name)
                .join(", ")}.`;

        await this.telegramClient.sendMessage(
          update.chatId,
          installedSummary,
          update.messageId,
        );
        await this.telegramClient.sendMessage(
          update.chatId,
          continuation,
          update.messageId,
        );
        await this.sendPendingFiles(
          update.userId,
          update.chatId,
          pendingFiles,
          update.messageId,
        );
      })
      .catch(async (error) => {
        this.logger.error("Background skill install failed", {
          userId: update.userId,
          source: pending.source,
          error: error instanceof Error ? error.message : String(error),
        });
        await this.telegramClient.sendMessage(
          update.chatId,
          `Skill install failed: ${error instanceof Error ? error.message : String(error)}`,
          update.messageId,
        );
      });

    return true;
  }

  private async handlePendingHomeMateBulkAction(
    update: NormalizedTelegramUpdate,
    pending: PendingHomeMateBulkSwitchAction,
  ): Promise<boolean> {
    if (isNegative(update.text)) {
      this.homeMateActionRegistry.clearPendingBulkSwitchAction(update.userId);
      await this.telegramClient.sendMessage(
        update.chatId,
        "Cancelled the pending HomeMate bulk switch action.",
        update.messageId,
      );
      return true;
    }

    if (!isAffirmative(update.text)) {
      return false;
    }

    await this.telegramClient.sendMessage(
      update.chatId,
      `Applying the pending HomeMate bulk switch action (${pending.requestedState}) now...`,
      update.messageId,
    );
    const result = await this.homeMateService.setSwitchesStateByIds(
      pending.switchIds,
      pending.requestedState,
    );
    this.homeMateActionRegistry.clearPendingBulkSwitchAction(update.userId);

    await this.telegramClient.sendMessage(
      update.chatId,
      formatHomeMateBulkResult(result),
      update.messageId,
    );
    return true;
  }

  private async handleVideoRecordingStop(
    update: NormalizedTelegramUpdate,
  ): Promise<void> {
    try {
      await this.telegramClient.sendMessage(
        update.chatId,
        "Stopping the video recording...",
        update.messageId,
      );

      const result = await this.webcamVideoService.stopRecording(update.userId);

      const durationSeconds = Math.round(result.durationMs / 1000);
      await this.telegramClient.sendVideo(
        update.chatId,
        result.filePath,
        `Recorded video (${durationSeconds}s)`,
        update.messageId,
      );

      await fs.unlink(result.filePath).catch((e) =>
        this.logger.warn("Failed to delete video file after send", {
          filePath: result.filePath,
          error: e instanceof Error ? e.message : String(e),
        }),
      );
    } catch (error) {
      this.logger.error("Failed to stop video recording", {
        userId: update.userId,
        error: error instanceof Error ? error.message : String(error),
      });
      await this.telegramClient.sendMessage(
        update.chatId,
        `Failed to stop video recording: ${error instanceof Error ? error.message : String(error)}`,
        update.messageId,
      );
    }
  }

  private getOrCreateSession(userId: string): ChatSession {
    let session = this.chatSessions.get(userId);
    if (!session) {
      session = createSession();
      this.chatSessions.set(userId, session);
    }
    return session;
  }

  private resetUserSession(userId: string): void {
    const session = this.chatSessions.get(userId);
    if (session) {
      resetSession(session);
    } else {
      this.chatSessions.set(userId, createSession());
    }
  }

  private async sendModelPicker(chatId: number): Promise<void> {
    const buttons = MODELS.map((model) => ({
      label: model.isDefault ? `✅ ${model.label} (default)` : model.label,
      callbackData: `set_model:${model.id}`,
    }));

    await this.telegramClient.sendMessageWithInlineKeyboard(
      chatId,
      "Fresh session started. Choose a model:",
      buttons,
    );
  }

  private async flushPendingFiles(
    userId: string,
    chatId: number,
    replyToMessageId?: number,
  ): Promise<void> {
    await this.sendPendingFiles(
      userId,
      chatId,
      this.outboundFileRegistry.drain(userId),
      replyToMessageId,
    );
  }

  private async sendPendingFiles(
    userId: string,
    chatId: number,
    pendingFiles: PendingOutboundFile[],
    replyToMessageId?: number,
  ): Promise<void> {
    for (const pendingFile of pendingFiles) {
      try {
        if (pendingFile.delivery === "photo") {
          await this.telegramClient.sendPhoto(
            chatId,
            pendingFile.filePath,
            pendingFile.caption,
            replyToMessageId,
          );
        } else if (pendingFile.delivery === "video") {
          // Skip placeholder entries used to store captions
          if (pendingFile.filePath === "__pending_video_caption__") {
            continue;
          }
          await this.telegramClient.sendVideo(
            chatId,
            pendingFile.filePath,
            pendingFile.caption,
            replyToMessageId,
          );
          await fs.unlink(pendingFile.filePath).catch((e) =>
            this.logger.warn("Failed to delete video file after send", {
              filePath: pendingFile.filePath,
              error: e instanceof Error ? e.message : String(e),
            }),
          );
        } else {
          await this.telegramClient.sendDocument(
            chatId,
            pendingFile.filePath,
            pendingFile.caption,
            replyToMessageId,
          );
        }
      } catch (error) {
        this.logger.error("Telegram file upload failed", {
          userId,
          chatId,
          filePath: pendingFile.filePath,
          error: error instanceof Error ? error.message : String(error),
        });
        await this.telegramClient.sendMessage(
          chatId,
          `File send failed for ${pendingFile.filePath}: ${error instanceof Error ? error.message : String(error)}`,
          replyToMessageId,
        );
      }
    }
  }
}

function formatSkillSearch(result: SkillSearchResult): string {
  if (result.candidates.length === 0) {
    return `No parsed skill candidates were found for "${result.query}".\n\nRaw output:\n${result.rawOutput || "(empty)"}`;
  }

  return [
    `Skill search results for "${result.query}":`,
    ...result.candidates.map((candidate) => `- ${candidate.title}`),
    "",
    "If you want one installed, use `/installskill <source> [skill1,skill2]` or ask me in plain language.",
  ].join("\n");
}

function formatPendingInstall(pending: PendingSkillInstallRequest): string {
  const skillList =
    pending.requestedSkills.length === 0
      ? "all skills discovered in that source"
      : pending.requestedSkills.join(", ");

  return [
    `Pending install request ${pending.id}`,
    `Source: ${pending.source}`,
    `Skills: ${skillList}`,
    "",
    "Reply YES to confirm or NO to cancel.",
  ].join("\n");
}

function formatGmailStatus(status: {
  configured: boolean;
  authCheckConfigured: boolean;
  command?: string;
  authenticated?: boolean;
  error?: string;
}): string {
  if (!status.configured) {
    return status.error || "Gmail is not configured.";
  }

  const lines = [
    `Google Workspace CLI: ${status.command || "configured"}`,
    `Auth check configured: ${status.authCheckConfigured ? "yes" : "no"}`,
  ];

  if (status.authenticated !== undefined) {
    lines.push(`Authenticated: ${status.authenticated ? "yes" : "no"}`);
  }

  if (status.error) {
    lines.push(`Error: ${status.error}`);
  }

  return lines.join("\n");
}

function formatGmailList(result: {
  query?: string;
  messages: Array<{
    id: string;
    from?: string;
    subject?: string;
    snippet?: string;
    internalDate?: string;
  }>;
}): string {
  if (result.messages.length === 0) {
    return result.query
      ? `No Gmail messages matched \"${result.query}\".`
      : "No Gmail messages were returned.";
  }

  return [
    result.query
      ? `Gmail messages for \"${result.query}\":`
      : "Recent Gmail messages:",
    ...result.messages.map((message) => {
      const summary = [
        message.subject || "(no subject)",
        message.from ? `from ${message.from}` : undefined,
        message.internalDate ? `at ${message.internalDate}` : undefined,
      ]
        .filter(Boolean)
        .join(" ");

      return `- ${message.id}: ${summary}${message.snippet ? `\n  ${message.snippet}` : ""}`;
    }),
  ].join("\n");
}

function formatGmailMessage(message: {
  id: string;
  from?: string;
  to?: string;
  subject?: string;
  internalDate?: string;
  bodyText?: string;
  snippet?: string;
}): string {
  return [
    `Message: ${message.id}`,
    `Subject: ${message.subject || "(no subject)"}`,
    message.from ? `From: ${message.from}` : undefined,
    message.to ? `To: ${message.to}` : undefined,
    message.internalDate ? `Date: ${message.internalDate}` : undefined,
    "",
    message.bodyText || message.snippet || "(no body returned)",
  ]
    .filter((line): line is string => line !== undefined)
    .join("\n");
}

function formatHomeMateBulkResult(result: {
  requestedState: "on" | "off";
  targetedSwitchCount: number;
  succeeded: Array<{ id: string; name: string }>;
  failed: Array<{ id: string; name?: string; error: string }>;
}): string {
  const lines = [
    `HomeMate bulk action completed: ${result.requestedState}`,
    `Targeted switches: ${result.targetedSwitchCount}`,
    `Succeeded: ${result.succeeded.length}`,
    `Failed: ${result.failed.length}`,
  ];

  if (result.succeeded.length > 0) {
    lines.push(
      "",
      "Succeeded switches:",
      ...result.succeeded.map((entry) => `- ${entry.name} (${entry.id})`),
    );
  }

  if (result.failed.length > 0) {
    lines.push(
      "",
      "Failed switches:",
      ...result.failed.map(
        (entry) =>
          `- ${entry.name ? `${entry.name} ` : ""}(${entry.id}): ${entry.error}`,
      ),
    );
  }

  return lines.join("\n");
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

function isGetUpdatesConflict(error: unknown): error is TelegramApiError {
  return (
    error instanceof TelegramApiError &&
    error.method === "getUpdates" &&
    error.statusCode === 409
  );
}
