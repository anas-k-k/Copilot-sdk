import { promises as fs } from "node:fs";

import { defineTool } from "@github/copilot-sdk";
import { z } from "zod";

import type { FileSearchService } from "../files/file-search-service.js";
import type { GoogleWorkspaceService } from "../google-workspace/google-workspace-service.js";
import type { HomeMateService } from "../homemate/homemate-service.js";
import type { HomeMateActionRegistry } from "../state/homemate-action-registry.js";
import type { OutboundFileRegistry } from "../state/outbound-file-registry.js";
import type { SkillInstallRegistry } from "../state/skill-install-registry.js";
import type { WebcamCaptureService } from "../webcam/webcam-capture-service.js";
import type { SkillService } from "../skills/skill-service.js";
import type { CopilotAgentRole } from "./agent-role.js";

interface ToolRegistryDependencies {
  skillService: SkillService;
  installRegistry: SkillInstallRegistry;
  googleWorkspaceService: GoogleWorkspaceService;
  homeMateService: HomeMateService;
  homeMateActionRegistry: HomeMateActionRegistry;
  fileSearchService: FileSearchService;
  outboundFileRegistry: OutboundFileRegistry;
  webcamCaptureService: WebcamCaptureService;
}

export class CopilotToolRegistry {
  public constructor(private readonly deps: ToolRegistryDependencies) {}

  public createTools(userId: string, role: CopilotAgentRole) {
    if (role !== "primary") {
      return [];
    }

    return [
      defineTool("search_skill_registry", {
        description:
          "Search the skills registry for reusable skills before attempting complex or long-running work directly.",
        parameters: z.object({
          query: z
            .string()
            .min(1)
            .describe("Search phrase describing the user's goal."),
        }),
        handler: async ({ query }) =>
          this.deps.skillService.searchSkills(query),
      }),
      defineTool("list_user_skills", {
        description: "List skills already installed for this Telegram user.",
        parameters: z.object({}),
        handler: async () => this.deps.skillService.listInstalledSkills(userId),
      }),
      defineTool("queue_skill_install", {
        description:
          "Queue a skill installation request for delegated follow-up after explicit user confirmation.",
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
          const pending = this.deps.installRegistry.stage(userId, {
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
            this.deps.googleWorkspaceService.getGmailConnectionStatus(),
          ),
      }),
      defineTool("gmail_list_messages", {
        description:
          "List Gmail messages through the configured Google Workspace CLI. Keep the query and maxResults narrow to avoid slow broad mailbox scans.",
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
            this.deps.googleWorkspaceService.listGmailMessages(request),
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
            this.deps.googleWorkspaceService.readGmailMessage(messageId),
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
            this.deps.googleWorkspaceService.sendGmailMessage(request),
          );
        },
      }),
      defineTool("homemate_connection_status", {
        description:
          "Check whether the HomeMate API is configured and reachable.",
        parameters: z.object({}),
        handler: async () =>
          safeToolResult(() => this.deps.homeMateService.getConnectionStatus()),
      }),
      defineTool("homemate_list_switches", {
        description:
          "List available HomeMate smart switches with ids, names, and current states.",
        parameters: z.object({}),
        handler: async () =>
          safeToolResult(() => this.deps.homeMateService.listSwitches()),
      }),
      defineTool("homemate_get_switch", {
        description:
          "Get the current state of a specific HomeMate smart switch by id or exact name.",
        parameters: z.object({
          identifier: z
            .string()
            .min(1)
            .describe("Switch id or exact switch name."),
        }),
        handler: async ({ identifier }) =>
          safeToolResult(() => this.deps.homeMateService.getSwitch(identifier)),
      }),
      defineTool("homemate_set_switch_state", {
        description:
          "Turn a specific HomeMate smart switch on or off by id or exact name.",
        parameters: z.object({
          identifier: z
            .string()
            .min(1)
            .describe("Switch id or exact switch name."),
          state: z
            .enum(["on", "off"])
            .describe("Desired target state for the switch."),
        }),
        handler: async ({ identifier, state }) =>
          safeToolResult(() =>
            this.deps.homeMateService.setSwitchState(identifier, state),
          ),
      }),
      defineTool("queue_homemate_bulk_switch_state", {
        description:
          "Queue a bulk HomeMate switch action that still needs explicit user confirmation.",
        parameters: z.object({
          state: z
            .enum(["on", "off"])
            .describe("Desired target state for all known switches."),
        }),
        handler: async ({ state }) =>
          safeToolResult(async () => {
            const staged =
              await this.deps.homeMateService.stageAllKnownSwitches(state);
            const pending =
              this.deps.homeMateActionRegistry.stageBulkSwitchAction(userId, {
                requestedState: staged.requestedState,
                switchIds: staged.switches.map((entry) => entry.id),
                switchNames: staged.switches.map((entry) => entry.name),
              });

            return {
              queued: true,
              requestId: pending.id,
              requestedState: pending.requestedState,
              switchCount: pending.switchIds.length,
              switchNames: pending.switchNames,
              confirmationMessage:
                "A pending bulk HomeMate switch action has been created. Ask the user to reply YES to confirm or NO to cancel.",
            };
          }),
      }),
      defineTool("search_local_files", {
        description:
          "Search the local machine for files matching a natural-language request. If the request is broad, ask for a narrower file name, folder, extension, or date range before repeating large searches.",
        parameters: z.object({
          query: z
            .string()
            .min(1)
            .describe(
              "Natural-language file request such as 'my adhar card image or doc'.",
            ),
        }),
        handler: async ({ query }) =>
          safeToolResult(() => this.deps.fileSearchService.searchFiles(query)),
      }),
      defineTool("capture_and_queue_webcam_photo", {
        description:
          "Open the local webcam capture flow, save a current photo, and queue it to be sent back to the Telegram user as a photo. Use this only when the user explicitly asks for a live or current webcam image.",
        parameters: z.object({
          caption: z
            .string()
            .max(500)
            .optional()
            .describe("Optional short caption to accompany the photo."),
        }),
        handler: async ({ caption }) =>
          safeToolResult(async () => {
            const captured =
              await this.deps.webcamCaptureService.capturePhoto(userId);

            this.deps.outboundFileRegistry.stage(userId, {
              filePath: captured.filePath,
              delivery: "photo",
              ...(caption ? { caption } : {}),
            });

            return {
              queued: true,
              filePath: captured.filePath,
              fileName: captured.fileName,
              sizeBytes: captured.sizeBytes,
              captureMethod: captured.captureMethod,
            };
          }),
      }),
      defineTool("queue_telegram_file_send", {
        description:
          "Queue a specific local file to be sent back to the Telegram user only after the user has clearly selected one file.",
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
            .describe("Optional short caption to accompany the Telegram file."),
        }),
        handler: async ({ filePath, caption }) =>
          safeToolResult(async () => {
            await fs.access(filePath);
            const file =
              await this.deps.fileSearchService.getSendableFile(filePath);
            this.deps.outboundFileRegistry.stage(userId, {
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
    ];
  }
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
