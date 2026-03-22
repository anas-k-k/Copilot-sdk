import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import type { AppConfig } from "../src/config/env.js";
import { Logger } from "../src/logging/logger.js";
import {
  TelegramApiError,
  TelegramClient,
} from "../src/telegram/telegram-client.js";

describe("TelegramClient", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("surfaces Telegram error descriptions for getUpdates conflicts", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              ok: false,
              error_code: 409,
              description:
                "Conflict: terminated by other getUpdates request; make sure that only one bot instance is running",
            }),
            {
              status: 409,
              headers: {
                "content-type": "application/json",
              },
            },
          ),
      ),
    );

    const client = new TelegramClient(createConfig(), new Logger("error"));

    await expect(client.getUpdates(undefined)).rejects.toMatchObject({
      method: "getUpdates",
      statusCode: 409,
      description:
        "Conflict: terminated by other getUpdates request; make sure that only one bot instance is running",
    });
  });

  it("calls deleteWebhook before polling can start", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(
      new Response(JSON.stringify({ ok: true, result: true }), {
        status: 200,
        headers: {
          "content-type": "application/json",
        },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const client = new TelegramClient(createConfig(), new Logger("error"));
    await client.deleteWebhook();

    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.telegram.org/bottoken/deleteWebhook",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("sends a typing chat action", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(
      new Response(JSON.stringify({ ok: true, result: true }), {
        status: 200,
        headers: {
          "content-type": "application/json",
        },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const client = new TelegramClient(createConfig(), new Logger("error"));
    await client.sendTypingAction(555);

    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.telegram.org/bottoken/sendChatAction",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          chat_id: 555,
          action: "typing",
        }),
      }),
    );
  });

  it("rewrites markdown-heavy replies into Telegram-friendly plain text", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: true, result: true }), {
        status: 200,
        headers: {
          "content-type": "application/json",
        },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const client = new TelegramClient(createConfig(), new Logger("error"));
    await client.sendMessage(
      555,
      [
        "Here are your last 2 HDFC emails:",
        "",
        "| # | Date | From | Subject |",
        "|---|---|---|---|",
        "| 1 | 22 Mar 2026 01:41 UTC | HDFC Bank InstaAlerts | View: Account update |",
        "| 2 | 21 Mar 2026 23:26 IST | HDFC Bank InstaAlerts | Rs.938.44 debited via Credit Card `**5765` |",
        "",
        "---",
        "Latest Gmail message:",
        "",
        "**From:** `SBI <sbi@example.com>`",
        "**Subject:** `New look`",
        "",
        "```text",
        "Line one",
        "Line two",
        "```",
      ].join("\n"),
    );

    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.telegram.org/bottoken/sendMessage",
      expect.objectContaining({ method: "POST" }),
    );

    const [, request] = fetchMock.mock.calls[0] ?? [];
    const payload = JSON.parse(String(request?.body ?? "{}")) as {
      chat_id: number;
      text: string;
      parse_mode: string;
    };

    expect(payload.chat_id).toBe(555);
    expect(payload.parse_mode).toBe("HTML");
    expect(payload.text).toContain("Here are your last 2 HDFC emails:");
    expect(payload.text).toContain("<pre># | Date");
    expect(payload.text).toContain(
      "2 | 21 Mar 2026 23:26 IST | HDFC Bank InstaAlerts | Rs.938.44 debited via Credit Card 5765",
    );
    expect(payload.text).toContain("Latest Gmail message:");
    expect(payload.text).toContain("From: SBI &lt;sbi@example.com&gt;");
    expect(payload.text).toContain("Subject: New look");
    expect(payload.text).toContain("<pre>Line one\nLine two</pre>");
  });

  it("renders plain pipe-delimited tables as Telegram preformatted tables", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: true, result: true }), {
        status: 200,
        headers: {
          "content-type": "application/json",
        },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const client = new TelegramClient(createConfig(), new Logger("error"));
    await client.sendMessage(
      555,
      [
        "Here is the account summary:",
        "",
        "Date | Type | Amount | Details",
        "18 Mar | Debit | Rs.360.00 | UPI to SHEBA BIRIYANI",
        "21 Mar | Credit | Rs.2,00,000.00 | NEFT credit from ZIYA-ANAS K K",
      ].join("\n"),
    );

    const [, request] = fetchMock.mock.calls[0] ?? [];
    const payload = JSON.parse(String(request?.body ?? "{}")) as {
      text: string;
      parse_mode: string;
    };

    expect(payload.parse_mode).toBe("HTML");
    expect(payload.text).toContain("Here is the account summary:");
    expect(payload.text).toContain("<pre>Date");
    expect(payload.text).toContain(
      "18 Mar | Debit  | Rs.360.00      | UPI to SHEBA BIRIYANI",
    );
    expect(payload.text).toContain(
      "21 Mar | Credit | Rs.2,00,000.00 | NEFT credit from ZIYA-ANAS K K",
    );
  });
  it("uploads documents through Telegram multipart form data", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "telegram-doc-"));
    const filePath = path.join(root, "aadhaar-card.txt");
    await writeFile(filePath, "sample", "utf8");

    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: true, result: true }), {
        status: 200,
        headers: {
          "content-type": "application/json",
        },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const client = new TelegramClient(createConfig(), new Logger("error"));
    await client.sendDocument(555, filePath, "Requested file", 10);

    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.telegram.org/bottoken/sendDocument",
      expect.objectContaining({ method: "POST" }),
    );

    const [, request] = fetchMock.mock.calls[0] ?? [];
    expect(request?.body).toBeInstanceOf(FormData);

    const formData = request?.body as FormData;
    expect(formData.get("chat_id")).toBe("555");
    expect(formData.get("caption")).toBe("Requested file");
    expect(formData.get("reply_to_message_id")).toBe("10");

    const document = formData.get("document");
    expect(document).toBeInstanceOf(File);
    expect((document as File).name).toBe("aadhaar-card.txt");
  });
});

function createConfig(): AppConfig {
  return {
    telegramBotToken: "token",
    telegramApiBaseUrl: "https://api.telegram.org",
    telegramPollingTimeoutSeconds: 30,
    telegramAllowedUserIds: [],
    copilotModel: "gpt-5",
    copilotCliPath: "copilot",
    copilotLogLevel: "info",
    appUserStateRoot: "C:\\temp",
    skillsCommand: "npx",
    skillsAgent: "github-copilot",
    googleWorkspaceCliCommand: undefined,
    googleWorkspaceCliArgs: [],
    gmailStatusArgs: [],
    gmailListArgs: [],
    gmailReadArgs: [],
    gmailSendArgs: [],
    gmailCommandTimeoutMs: 30_000,
    fileSearchRoots: ["C:\\"],
    fileSearchExcludedRoots: [],
    fileSearchMaxResults: 10,
    fileSearchContentExtensions: [".txt", ".md", ".json", ".csv", ".log"],
    fileSearchContentMaxFileSizeBytes: 1_000_000,
    fileSendMaxFileSizeBytes: 10 * 1024 * 1024,
    fileSearchAliases: {
      adhar: ["aadhaar", "aadhar"],
      aadhaar: ["adhar", "aadhar"],
      aadhar: ["aadhaar", "adhar"],
    },
    fileSearchMaxDurationMs: 15_000,
    fileSearchMaxFilesScanned: 20_000,
  };
}
