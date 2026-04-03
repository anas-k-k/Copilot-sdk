import { promises as fs } from "node:fs";

import type { Tool } from "ollama";

import type { FileSearchService } from "../files/file-search-service.js";
import type { GoogleWorkspaceService } from "../google-workspace/google-workspace-service.js";
import type { HomeMateService } from "../homemate/homemate-service.js";
import type { HomeMateActionRegistry } from "../state/homemate-action-registry.js";
import type { OutboundFileRegistry } from "../state/outbound-file-registry.js";
import type { SkillInstallRegistry } from "../state/skill-install-registry.js";
import type { SkillService } from "../skills/skill-service.js";
import type { WebcamCaptureService } from "../webcam/webcam-capture-service.js";
import type { WebcamVideoService } from "../webcam/webcam-video-service.js";

export interface OllamaToolRegistryDependencies {
  skillService: SkillService;
  installRegistry: SkillInstallRegistry;
  googleWorkspaceService: GoogleWorkspaceService;
  homeMateService: HomeMateService;
  homeMateActionRegistry: HomeMateActionRegistry;
  fileSearchService: FileSearchService;
  outboundFileRegistry: OutboundFileRegistry;
  webcamCaptureService: WebcamCaptureService;
  webcamVideoService: WebcamVideoService;
}

type ToolHandler = (
  userId: string,
  args: Record<string, unknown>,
) => Promise<unknown>;

interface OllamaToolEntry {
  tool: Tool;
  handler: ToolHandler;
}

export class OllamaToolRegistry {
  private readonly entries: OllamaToolEntry[];

  public constructor(private readonly deps: OllamaToolRegistryDependencies) {
    this.entries = this.buildEntries();
  }

  public getTools(): Tool[] {
    return this.entries.map((entry) => entry.tool);
  }

  public async callTool(
    userId: string,
    name: string,
    args: Record<string, unknown>,
  ): Promise<string> {
    const entry = this.entries.find((e) => e.tool.function.name === name);
    if (!entry) {
      return JSON.stringify({ ok: false, error: `Unknown tool: ${name}` });
    }

    try {
      const result = await entry.handler(userId, args);
      return JSON.stringify(result);
    } catch (error) {
      return JSON.stringify({
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private buildEntries(): OllamaToolEntry[] {
    return [
      {
        tool: {
          type: "function",
          function: {
            name: "search_skill_registry",
            description:
              "Search the skills registry for reusable skills before attempting complex or long-running work directly.",
            parameters: {
              type: "object",
              required: ["query"],
              properties: {
                query: {
                  type: "string",
                  description: "Search phrase describing the user's goal.",
                },
              },
            },
          },
        },
        handler: async (_userId, args) =>
          safeResult(() =>
            this.deps.skillService.searchSkills(String(args["query"] ?? "")),
          ),
      },
      {
        tool: {
          type: "function",
          function: {
            name: "list_user_skills",
            description:
              "List skills already installed for this Telegram user.",
            parameters: { type: "object", properties: {} },
          },
        },
        handler: async (userId) =>
          safeResult(() => this.deps.skillService.listInstalledSkills(userId)),
      },
      {
        tool: {
          type: "function",
          function: {
            name: "queue_skill_install",
            description:
              "Queue a skill installation request for delegated follow-up after explicit user confirmation.",
            parameters: {
              type: "object",
              required: ["source", "reason", "goal"],
              properties: {
                source: {
                  type: "string",
                  description: "Skill source like owner/repo or a git URL.",
                },
                skills: {
                  type: "array",
                  items: { type: "string" },
                  description: "Specific skill names to install.",
                },
                reason: {
                  type: "string",
                  description: "Why this skill helps with the task.",
                },
                goal: {
                  type: "string",
                  description:
                    "Short summary of the user's task to continue after install.",
                },
              },
            },
          },
        },
        handler: async (userId, args) => {
          const source = String(args["source"] ?? "");
          const reason = String(args["reason"] ?? "");
          const goal = String(args["goal"] ?? "");
          const skills = Array.isArray(args["skills"])
            ? (args["skills"] as unknown[]).map(String)
            : [];

          const pending = this.deps.installRegistry.stage(userId, {
            source,
            requestedSkills: skills,
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
      },
      {
        tool: {
          type: "function",
          function: {
            name: "gmail_connection_status",
            description:
              "Check whether Gmail is available through the configured Google Workspace CLI.",
            parameters: { type: "object", properties: {} },
          },
        },
        handler: async () =>
          safeResult(() =>
            this.deps.googleWorkspaceService.getGmailConnectionStatus(),
          ),
      },
      {
        tool: {
          type: "function",
          function: {
            name: "gmail_list_messages",
            description:
              "List Gmail messages through the configured Google Workspace CLI. Keep the query and maxResults narrow to avoid slow broad mailbox scans.",
            parameters: {
              type: "object",
              properties: {
                query: {
                  type: "string",
                  description:
                    "Optional Gmail search query, for example is:unread newer_than:7d.",
                },
                maxResults: {
                  type: "number",
                  description: "Maximum number of messages to return (1-25).",
                },
              },
            },
          },
        },
        handler: async (_userId, args) => {
          const query =
            args["query"] !== undefined ? String(args["query"]) : undefined;
          const maxResults =
            args["maxResults"] !== undefined
              ? Number(args["maxResults"])
              : undefined;

          return safeResult(() =>
            this.deps.googleWorkspaceService.listGmailMessages({
              ...(query ? { query } : {}),
              ...(maxResults !== undefined ? { maxResults } : {}),
            }),
          );
        },
      },
      {
        tool: {
          type: "function",
          function: {
            name: "gmail_read_message",
            description:
              "Read a Gmail message by id through the configured Google Workspace CLI.",
            parameters: {
              type: "object",
              required: ["messageId"],
              properties: {
                messageId: {
                  type: "string",
                  description: "The Gmail message id.",
                },
              },
            },
          },
        },
        handler: async (_userId, args) =>
          safeResult(() =>
            this.deps.googleWorkspaceService.readGmailMessage(
              String(args["messageId"] ?? ""),
            ),
          ),
      },
      {
        tool: {
          type: "function",
          function: {
            name: "gmail_send_message",
            description:
              "Send a Gmail message through the configured Google Workspace CLI.",
            parameters: {
              type: "object",
              required: ["to", "subject", "body"],
              properties: {
                to: {
                  type: "array",
                  items: { type: "string" },
                  description: "Recipient email addresses.",
                },
                subject: {
                  type: "string",
                  description: "Email subject.",
                },
                body: {
                  type: "string",
                  description: "Plain text email body.",
                },
                cc: {
                  type: "array",
                  items: { type: "string" },
                  description: "Optional CC email addresses.",
                },
                bcc: {
                  type: "array",
                  items: { type: "string" },
                  description: "Optional BCC email addresses.",
                },
              },
            },
          },
        },
        handler: async (_userId, args) => {
          const to = Array.isArray(args["to"])
            ? (args["to"] as unknown[]).map(String)
            : [];
          const subject = String(args["subject"] ?? "");
          const body = String(args["body"] ?? "");
          const cc = Array.isArray(args["cc"])
            ? (args["cc"] as unknown[]).map(String)
            : undefined;
          const bcc = Array.isArray(args["bcc"])
            ? (args["bcc"] as unknown[]).map(String)
            : undefined;

          return safeResult(() =>
            this.deps.googleWorkspaceService.sendGmailMessage({
              to,
              subject,
              body,
              ...(cc ? { cc } : {}),
              ...(bcc ? { bcc } : {}),
            }),
          );
        },
      },
      {
        tool: {
          type: "function",
          function: {
            name: "homemate_connection_status",
            description:
              "Check whether the HomeMate API is configured and reachable.",
            parameters: { type: "object", properties: {} },
          },
        },
        handler: async () =>
          safeResult(() => this.deps.homeMateService.getConnectionStatus()),
      },
      {
        tool: {
          type: "function",
          function: {
            name: "homemate_list_switches",
            description:
              "List available HomeMate smart switches with ids, names, and current states.",
            parameters: { type: "object", properties: {} },
          },
        },
        handler: async () =>
          safeResult(() => this.deps.homeMateService.listSwitches()),
      },
      {
        tool: {
          type: "function",
          function: {
            name: "homemate_get_switch",
            description:
              "Get the current state of a specific HomeMate smart switch by id or exact name.",
            parameters: {
              type: "object",
              required: ["identifier"],
              properties: {
                identifier: {
                  type: "string",
                  description: "Switch id or exact switch name.",
                },
              },
            },
          },
        },
        handler: async (_userId, args) =>
          safeResult(() =>
            this.deps.homeMateService.getSwitch(
              String(args["identifier"] ?? ""),
            ),
          ),
      },
      {
        tool: {
          type: "function",
          function: {
            name: "homemate_set_switch_state",
            description:
              "Turn a specific HomeMate smart switch on or off by id or exact name.",
            parameters: {
              type: "object",
              required: ["identifier", "state"],
              properties: {
                identifier: {
                  type: "string",
                  description: "Switch id or exact switch name.",
                },
                state: {
                  type: "string",
                  enum: ["on", "off"],
                  description: "Desired target state for the switch.",
                },
              },
            },
          },
        },
        handler: async (_userId, args) => {
          const state = String(args["state"] ?? "") as "on" | "off";
          return safeResult(() =>
            this.deps.homeMateService.setSwitchState(
              String(args["identifier"] ?? ""),
              state,
            ),
          );
        },
      },
      {
        tool: {
          type: "function",
          function: {
            name: "queue_homemate_bulk_switch_state",
            description:
              "Queue a bulk HomeMate switch action that still needs explicit user confirmation.",
            parameters: {
              type: "object",
              required: ["state"],
              properties: {
                state: {
                  type: "string",
                  enum: ["on", "off"],
                  description:
                    "Desired target state for all known switches.",
                },
              },
            },
          },
        },
        handler: async (userId, args) =>
          safeResult(async () => {
            const state = String(args["state"] ?? "") as "on" | "off";
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
      },
      {
        tool: {
          type: "function",
          function: {
            name: "search_local_files",
            description:
              "Search the local machine for files matching a natural-language request. If the request is broad, ask for a narrower file name, folder, extension, or date range before repeating large searches.",
            parameters: {
              type: "object",
              required: ["query"],
              properties: {
                query: {
                  type: "string",
                  description:
                    "Natural-language file request such as 'my adhar card image or doc'.",
                },
              },
            },
          },
        },
        handler: async (_userId, args) =>
          safeResult(() =>
            this.deps.fileSearchService.searchFiles(
              String(args["query"] ?? ""),
            ),
          ),
      },
      {
        tool: {
          type: "function",
          function: {
            name: "capture_and_queue_webcam_photo",
            description:
              "Open the local webcam capture flow, save a current photo, and queue it to be sent back to the Telegram user as a photo. Use this only when the user explicitly asks for a live or current webcam image.",
            parameters: {
              type: "object",
              properties: {
                caption: {
                  type: "string",
                  description: "Optional short caption to accompany the photo.",
                },
              },
            },
          },
        },
        handler: async (userId, args) =>
          safeResult(async () => {
            const caption =
              args["caption"] !== undefined
                ? String(args["caption"])
                : undefined;
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
      },
      {
        tool: {
          type: "function",
          function: {
            name: "start_webcam_video_recording",
            description:
              "Start recording a live video from the local webcam. The recording continues in the background until stop_webcam_video_recording is called or the user says stop. Use this only when the user explicitly asks for a live video recording.",
            parameters: {
              type: "object",
              properties: {
                caption: {
                  type: "string",
                  description:
                    "Optional short caption to accompany the video when sent.",
                },
              },
            },
          },
        },
        handler: async (userId, args) =>
          safeResult(async () => {
            const caption =
              args["caption"] !== undefined
                ? String(args["caption"])
                : undefined;
            const result =
              await this.deps.webcamVideoService.startRecording(userId);

            if (caption) {
              this.deps.outboundFileRegistry.stage(userId, {
                filePath: "__pending_video_caption__",
                caption,
                delivery: "video",
              });
            }

            return {
              started: true,
              filePath: result.filePath,
              message:
                "Video recording started. The user can say stop to end the recording and receive the video.",
            };
          }),
      },
      {
        tool: {
          type: "function",
          function: {
            name: "stop_webcam_video_recording",
            description:
              "Stop an active webcam video recording and queue the recorded video to be sent back to the Telegram user. Use this when the user asks to stop the recording.",
            parameters: { type: "object", properties: {} },
          },
        },
        handler: async (userId) =>
          safeResult(async () => {
            const result =
              await this.deps.webcamVideoService.stopRecording(userId);

            this.deps.outboundFileRegistry.stage(userId, {
              filePath: result.filePath,
              delivery: "video",
            });

            return {
              queued: true,
              filePath: result.filePath,
              fileName: result.fileName,
              sizeBytes: result.sizeBytes,
              durationMs: result.durationMs,
              recordingMethod: result.recordingMethod,
            };
          }),
      },
      {
        tool: {
          type: "function",
          function: {
            name: "queue_telegram_file_send",
            description:
              "Queue a specific local file to be sent back to the Telegram user only after the user has clearly selected one file.",
            parameters: {
              type: "object",
              required: ["filePath"],
              properties: {
                filePath: {
                  type: "string",
                  description:
                    "Absolute file path of the specific file the user selected.",
                },
                caption: {
                  type: "string",
                  description:
                    "Optional short caption to accompany the Telegram file.",
                },
              },
            },
          },
        },
        handler: async (userId, args) =>
          safeResult(async () => {
            const filePath = String(args["filePath"] ?? "");
            const caption =
              args["caption"] !== undefined
                ? String(args["caption"])
                : undefined;

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
      },
    ];
  }
}

async function safeResult<T>(
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
