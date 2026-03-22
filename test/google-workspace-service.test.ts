import { describe, expect, it, vi } from "vitest";

import type { AppConfig } from "../src/config/env.js";
import { GoogleWorkspaceService } from "../src/google-workspace/google-workspace-service.js";
import { Logger } from "../src/logging/logger.js";

function createConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    telegramBotToken: "token",
    telegramApiBaseUrl: "https://api.telegram.org",
    telegramPollingTimeoutSeconds: 30,
    telegramAllowedUserIds: [],
    copilotModel: "gpt-5",
    copilotCliPath: "copilot",
    copilotLogLevel: "info",
    appUserStateRoot: ".\\data\\users",
    skillsCommand: "npx",
    skillsAgent: "github-copilot",
    googleWorkspaceCliCommand: "gws",
    googleWorkspaceCliArgs: [],
    gmailStatusArgs: ["auth", "status"],
    gmailListArgs: [
      "gmail",
      "+triage",
      "--format=json",
      "--query={query}",
      "--max={maxResults}",
    ],
    gmailReadArgs: ["gmail", "+read", "--id={messageId}", "--format=json"],
    gmailSendArgs: [
      "gmail",
      "+send",
      "--to={to}",
      "--cc={cc}",
      "--bcc={bcc}",
      "--subject={subject}",
      "--body={body}",
    ],
    gmailCommandTimeoutMs: 30_000,
    fileSearchRoots: ["C:\\"],
    fileSearchExcludedRoots: [],
    fileSearchMaxResults: 10,
    fileSearchContentExtensions: [
      ".txt",
      ".md",
      ".json",
      ".csv",
      ".log",
      ".pdf",
    ],
    fileSearchContentMaxFileSizeBytes: 1_000_000,
    fileSendMaxFileSizeBytes: 10 * 1024 * 1024,
    fileSearchAliases: {
      adhar: ["aadhaar", "aadhar"],
      aadhaar: ["adhar", "aadhar"],
      aadhar: ["aadhaar", "adhar"],
    },
    fileSearchMaxDurationMs: 15_000,
    fileSearchMaxFilesScanned: 20_000,
    ...overrides,
  };
}

describe("GoogleWorkspaceService", () => {
  it("returns an unconfigured status when no CLI command is set", async () => {
    const service = new GoogleWorkspaceService(
      createConfig({ googleWorkspaceCliCommand: undefined }),
      new Logger("error"),
    );

    const status = await service.getGmailConnectionStatus();

    expect(status.configured).toBe(false);
    expect(status.error).toContain("GOOGLE_WORKSPACE_CLI_COMMAND");
  });

  it("expands list templates and normalizes JSON output", async () => {
    const execText = vi.fn().mockResolvedValue({
      stdout: JSON.stringify({
        messages: [
          {
            id: "msg-1",
            threadId: "thread-1",
            snippet: "Snippet",
            payload: {
              headers: [
                { name: "Subject", value: "Quarterly update" },
                { name: "From", value: "boss@example.com" },
              ],
            },
          },
        ],
      }),
      stderr: "",
    });

    const service = new GoogleWorkspaceService(
      createConfig(),
      new Logger("error"),
      execText,
    );

    const result = await service.listGmailMessages({
      query: "is:unread",
      maxResults: 5,
    });

    expect(execText).toHaveBeenCalledWith(
      "gws",
      ["gmail", "+triage", "--format=json", "--query=is:unread", "--max=5"],
      expect.objectContaining({ timeoutMs: 30_000 }),
    );
    expect(result.messages).toEqual([
      expect.objectContaining({
        id: "msg-1",
        threadId: "thread-1",
        subject: "Quarterly update",
        from: "boss@example.com",
        snippet: "Snippet",
      }),
    ]);
  });

  it("normalizes a detailed message payload", async () => {
    const execText = vi.fn().mockResolvedValue({
      stdout: JSON.stringify({
        id: "msg-42",
        snippet: "Hello there",
        payload: {
          headers: [
            { name: "Subject", value: "Hello" },
            { name: "From", value: "friend@example.com" },
            { name: "To", value: "me@example.com" },
          ],
          body: {
            data: "Body from CLI",
          },
        },
      }),
      stderr: "",
    });

    const service = new GoogleWorkspaceService(
      createConfig(),
      new Logger("error"),
      execText,
    );

    const result = await service.readGmailMessage("msg-42");

    expect(result.id).toBe("msg-42");
    expect(result.subject).toBe("Hello");
    expect(result.from).toBe("friend@example.com");
    expect(result.to).toBe("me@example.com");
    expect(result.bodyText).toBe("Body from CLI");
  });

  it("omits empty option assignments after template expansion", async () => {
    const execText = vi.fn().mockResolvedValue({
      stdout: JSON.stringify({ id: "sent-1" }),
      stderr: "",
    });

    const service = new GoogleWorkspaceService(
      createConfig(),
      new Logger("error"),
      execText,
    );

    await service.sendGmailMessage({
      to: ["user@example.com"],
      subject: "Hello",
      body: "Body",
    });

    expect(execText).toHaveBeenCalledWith(
      "gws",
      [
        "gmail",
        "+send",
        "--to=user@example.com",
        "--subject=Hello",
        "--body=Body",
      ],
      expect.anything(),
    );
  });
});
