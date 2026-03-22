import type { NormalizedTelegramUpdate, TelegramUpdate } from "./types.js";

export function normalizeTelegramUpdate(
  update: TelegramUpdate,
): NormalizedTelegramUpdate | undefined {
  const message = update.message;
  if (!message?.text?.trim() || !message.from) {
    return undefined;
  }

  const text = message.text.trim();
  const commandMatch = text.match(
    /^\/([A-Za-z0-9_]+)(?:@\w+)?(?:\s+([\s\S]+))?$/,
  );
  const commandName = commandMatch?.[1]?.toLowerCase();
  const commandArgs = commandMatch?.[2]?.trim();

  return {
    updateId: update.update_id,
    messageId: message.message_id,
    chatId: message.chat.id,
    userId: String(message.from.id),
    username: message.from.username,
    text,
    commandName,
    commandArgs,
  };
}
