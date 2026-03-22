import { describe, expect, it } from "vitest";

import { normalizeTelegramUpdate } from "../src/telegram/update-normalizer.js";

describe("normalizeTelegramUpdate", () => {
  it("normalizes a plain text message", () => {
    const normalized = normalizeTelegramUpdate({
      update_id: 10,
      message: {
        message_id: 20,
        text: "hello there",
        chat: { id: 30 },
        from: { id: 40 },
      },
    });

    expect(normalized).toEqual({
      updateId: 10,
      messageId: 20,
      chatId: 30,
      userId: "40",
      username: undefined,
      text: "hello there",
      commandName: undefined,
      commandArgs: undefined,
    });
  });

  it("includes the Telegram username when present", () => {
    const normalized = normalizeTelegramUpdate({
      update_id: 12,
      message: {
        message_id: 22,
        text: "hello",
        chat: { id: 32 },
        from: { id: 42, username: "intruder_user" },
      },
    });

    expect(normalized?.username).toBe("intruder_user");
  });

  it("extracts a command and arguments", () => {
    const normalized = normalizeTelegramUpdate({
      update_id: 11,
      message: {
        message_id: 21,
        text: "/searchskill typescript linting",
        chat: { id: 31 },
        from: { id: 41 },
      },
    });

    expect(normalized?.commandName).toBe("searchskill");
    expect(normalized?.commandArgs).toBe("typescript linting");
  });
});
