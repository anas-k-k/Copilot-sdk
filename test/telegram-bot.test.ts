import { describe, expect, it, vi } from "vitest";

import { OutboundFileRegistry } from "../src/state/outbound-file-registry.js";
import { TelegramBot } from "../src/telegram/telegram-bot.js";
import { TelegramApiError } from "../src/telegram/telegram-client.js";
import { Logger } from "../src/logging/logger.js";

describe("TelegramBot", () => {
  it("stops polling after a getUpdates conflict", async () => {
    let deleteWebhookCalls = 0;
    let getUpdatesCalls = 0;

    const telegramClient = {
      deleteWebhook: async () => {
        deleteWebhookCalls += 1;
      },
      getUpdates: async () => {
        getUpdatesCalls += 1;
        throw new TelegramApiError(
          "getUpdates",
          409,
          "Conflict: terminated by other getUpdates request; make sure that only one bot instance is running",
        );
      },
      sendTypingAction: async () => {},
      sendMessage: async () => {},
      sendDocument: async () => {},
    } as never;

    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    const bot = new TelegramBot(
      telegramClient,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      new OutboundFileRegistry(),
      new Logger("info"),
      new Set(),
    );

    await bot.start();

    expect(deleteWebhookCalls).toBe(1);
    expect(getUpdatesCalls).toBe(1);
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining(
        "Telegram polling conflict detected; stopping polling",
      ),
    );

    errorSpy.mockRestore();
    logSpy.mockRestore();
  });

  it("ignores messages from users outside the allowlist", async () => {
    const sendPrompt = vi.fn();
    const sendMessage = vi.fn();
    let getUpdatesCalls = 0;

    const telegramClient = {
      deleteWebhook: async () => {},
      getUpdates: async () => {
        getUpdatesCalls += 1;

        if (getUpdatesCalls === 1) {
          return [
            {
              update_id: 1,
              message: {
                message_id: 10,
                text: "hello",
                chat: { id: 555 },
                from: { id: 999, username: "someone_else" },
              },
            },
          ];
        }

        throw new TelegramApiError(
          "getUpdates",
          409,
          "Conflict: terminated by other getUpdates request; make sure that only one bot instance is running",
        );
      },
      sendTypingAction: async () => {},
      sendMessage,
      sendDocument: async () => {},
    } as never;

    const bot = new TelegramBot(
      telegramClient,
      {
        sendPrompt,
      } as never,
      {} as never,
      {
        getPending: vi.fn(),
      } as never,
      {} as never,
      new OutboundFileRegistry(),
      new Logger("debug"),
      new Set(["8661077453"]),
    );

    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await bot.start();

    expect(sendPrompt).not.toHaveBeenCalled();
    expect(sendMessage).not.toHaveBeenCalled();
    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining(
        'Ignoring Telegram message from unauthorized user {"userId":"999","username":"someone_else","chatId":555,"text":"hello"}',
      ),
    );

    errorSpy.mockRestore();
    logSpy.mockRestore();
  });

  it("logs reply failures without crashing the polling loop", async () => {
    const sendMessage = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("fetch failed"));
    const sendTypingAction = vi.fn().mockResolvedValue(undefined);
    let getUpdatesCalls = 0;

    const telegramClient = {
      deleteWebhook: async () => {},
      getUpdates: async () => {
        getUpdatesCalls += 1;

        if (getUpdatesCalls === 1) {
          return [
            {
              update_id: 1,
              message: {
                message_id: 10,
                text: "/gmailstatus",
                chat: { id: 555 },
                from: { id: 8661077453, username: "anas" },
              },
            },
          ];
        }

        throw new TelegramApiError(
          "getUpdates",
          409,
          "Conflict: terminated by other getUpdates request; make sure that only one bot instance is running",
        );
      },
      sendTypingAction,
      sendMessage,
      sendDocument: async () => {},
    } as never;

    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    const bot = new TelegramBot(
      telegramClient,
      {} as never,
      {} as never,
      {
        getPending: vi.fn(),
      } as never,
      {
        getGmailConnectionStatus: vi.fn().mockResolvedValue({
          configured: true,
          authCheckConfigured: true,
          authenticated: true,
          baseArgs: [],
        }),
      } as never,
      new OutboundFileRegistry(),
      new Logger("info"),
      new Set(),
    );

    await bot.start();
    await vi.waitFor(() => {
      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining("Telegram update processing failed"),
      );
    });

    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(sendTypingAction).toHaveBeenCalledTimes(1);

    errorSpy.mockRestore();
    logSpy.mockRestore();
  });

  it("keeps sending typing actions while waiting for a Copilot reply", async () => {
    vi.useFakeTimers();

    const sendTypingAction = vi.fn().mockResolvedValue(undefined);
    const sendMessage = vi.fn().mockResolvedValue(undefined);
    const sendDocument = vi.fn().mockResolvedValue(undefined);
    let getUpdatesCalls = 0;

    let resolvePrompt: ((value: string) => void) | undefined;
    const sendPrompt = vi.fn(
      () =>
        new Promise<string>((resolve) => {
          resolvePrompt = resolve;
        }),
    );

    const telegramClient = {
      deleteWebhook: async () => {},
      getUpdates: async () => {
        getUpdatesCalls += 1;

        if (getUpdatesCalls === 1) {
          return [
            {
              update_id: 1,
              message: {
                message_id: 10,
                text: "hello",
                chat: { id: 555 },
                from: { id: 8661077453, username: "anas" },
              },
            },
          ];
        }

        throw new TelegramApiError(
          "getUpdates",
          409,
          "Conflict: terminated by other getUpdates request; make sure that only one bot instance is running",
        );
      },
      sendTypingAction,
      sendMessage,
      sendDocument,
    } as never;

    const outboundFileRegistry = new OutboundFileRegistry();
    outboundFileRegistry.stage("8661077453", {
      filePath: "C:\\Users\\Anas\\Documents\\aadhaar-card.txt",
      caption: "Requested file",
    });

    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    const bot = new TelegramBot(
      telegramClient,
      {
        sendPrompt,
      } as never,
      {} as never,
      {
        getPending: vi.fn(),
      } as never,
      {} as never,
      outboundFileRegistry,
      new Logger("info"),
      new Set(),
    );

    await bot.start();
    await vi.waitFor(() => {
      expect(sendTypingAction).toHaveBeenCalledTimes(1);
    });

    await vi.advanceTimersByTimeAsync(4_000);
    await vi.waitFor(() => {
      expect(sendTypingAction).toHaveBeenCalledTimes(2);
    });

    resolvePrompt?.("Response ready");

    await vi.waitFor(() => {
      expect(sendMessage).toHaveBeenCalledWith(555, "Response ready", 10);
    });
    await vi.waitFor(() => {
      expect(sendDocument).toHaveBeenCalledWith(
        555,
        "C:\\Users\\Anas\\Documents\\aadhaar-card.txt",
        "Requested file",
        10,
      );
    });
    const firstTypingCall = sendTypingAction.mock.invocationCallOrder[0];
    const firstMessageCall = sendMessage.mock.invocationCallOrder[0];

    expect(firstTypingCall).toBeDefined();
    expect(firstMessageCall).toBeDefined();
    expect(firstTypingCall!).toBeLessThan(firstMessageCall!);

    vi.useRealTimers();

    errorSpy.mockRestore();
    logSpy.mockRestore();
  });
});
