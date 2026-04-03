import { promises as fs } from "node:fs";
import path from "node:path";

import type { AppConfig } from "../config/env.js";
import { formatTelegramMessage, splitMessage } from "../utils/text.js";
import type { Logger } from "../logging/logger.js";
import type { TelegramApiResponse, TelegramUpdate } from "./types.js";

export class TelegramApiError extends Error {
  public constructor(
    public readonly method: string,
    public readonly statusCode: number,
    public readonly description?: string,
  ) {
    super(
      description
        ? `Telegram ${method} failed with status ${statusCode}: ${description}`
        : `Telegram ${method} failed with status ${statusCode}.`,
    );
    this.name = "TelegramApiError";
  }
}

export class TelegramClient {
  private readonly baseUrl: string;

  public constructor(
    private readonly config: AppConfig,
    private readonly logger: Logger,
  ) {
    this.baseUrl = `${this.config.telegramApiBaseUrl}/bot${this.config.telegramBotToken}`;
  }

  public async getUpdates(
    offset: number | undefined,
  ): Promise<TelegramUpdate[]> {
    const url = new URL(`${this.baseUrl}/getUpdates`);
    if (offset !== undefined) {
      url.searchParams.set("offset", String(offset));
    }

    url.searchParams.set(
      "timeout",
      String(this.config.telegramPollingTimeoutSeconds),
    );

    url.searchParams.set(
      "allowed_updates",
      JSON.stringify(["message", "callback_query"]),
    );

    return this.requestTelegram<TelegramUpdate[]>("getUpdates", {
      method: "GET",
      url,
    });
  }

  public async deleteWebhook(dropPendingUpdates = false): Promise<void> {
    await this.requestTelegram<true>("deleteWebhook", {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        drop_pending_updates: dropPendingUpdates,
      }),
    });
  }

  public async sendTypingAction(chatId: number): Promise<void> {
    await this.requestTelegram<true>("sendChatAction", {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        chat_id: chatId,
        action: "typing",
      }),
    });
  }

  public async sendMessage(
    chatId: number,
    text: string,
    replyToMessageId?: number,
  ): Promise<void> {
    const formattedMessage = formatTelegramMessage(text);

    for (const chunk of splitMessage(formattedMessage.text, 3900)) {
      await this.requestTelegram<true>("sendMessage", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          chat_id: chatId,
          text: chunk,
          parse_mode: formattedMessage.parseMode,
          reply_to_message_id: replyToMessageId,
        }),
      });
    }
  }

  public async sendDocument(
    chatId: number,
    filePath: string,
    caption?: string,
    replyToMessageId?: number,
  ): Promise<void> {
    const formData = await buildTelegramFileFormData(
      chatId,
      filePath,
      "document",
      caption,
      replyToMessageId,
    );

    if (path.extname(filePath).toLowerCase() === ".pdf") {
      formData.set("disable_content_type_detection", "true");
    }

    await this.requestTelegram<true>("sendDocument", {
      method: "POST",
      body: formData,
    });
  }

  public async sendPhoto(
    chatId: number,
    filePath: string,
    caption?: string,
    replyToMessageId?: number,
  ): Promise<void> {
    const formData = await buildTelegramFileFormData(
      chatId,
      filePath,
      "photo",
      caption,
      replyToMessageId,
    );

    await this.requestTelegram<true>("sendPhoto", {
      method: "POST",
      body: formData,
    });
  }

  public async sendVideo(
    chatId: number,
    filePath: string,
    caption?: string,
    replyToMessageId?: number,
  ): Promise<void> {
    const formData = await buildTelegramFileFormData(
      chatId,
      filePath,
      "video",
      caption,
      replyToMessageId,
    );

    await this.requestTelegram<true>("sendVideo", {
      method: "POST",
      body: formData,
    });
  }

  public async sendMessageWithInlineKeyboard(
    chatId: number,
    text: string,
    buttons: Array<{ label: string; callbackData: string }>,
  ): Promise<void> {
    const inlineKeyboard = buttons.map((btn) => [
      { text: btn.label, callback_data: btn.callbackData },
    ]);

    await this.requestTelegram<true>("sendMessage", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        reply_markup: { inline_keyboard: inlineKeyboard },
      }),
    });
  }

  public async answerCallbackQuery(callbackQueryId: string): Promise<void> {
    await this.requestTelegram<true>("answerCallbackQuery", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ callback_query_id: callbackQueryId }),
    });
  }

  private async requestTelegram<TResult>(
    method: string,
    options:
      | { method: "GET"; url: URL }
      | { method: "POST"; body: BodyInit; headers?: Record<string, string> },
  ): Promise<TResult> {
    const response = await fetch(
      options.method === "GET" ? options.url : `${this.baseUrl}/${method}`,
      options.method === "GET"
        ? { method: "GET" }
        : {
            method: "POST",
            ...(options.headers ? { headers: options.headers } : {}),
            body: options.body,
          },
    );

    const payload = await readTelegramPayload<TResult>(response);
    if (!response.ok || !payload?.ok) {
      const description = payload?.description;
      this.logger.warn("Telegram API reported an error", {
        method,
        statusCode: response.status,
        description,
        body: options.method === "POST" ? options.body : undefined,
      });
      throw new TelegramApiError(method, response.status, description);
    }

    return payload.result;
  }
}

function getMimeTypeForPath(filePath: string): string {
  switch (path.extname(filePath).toLowerCase()) {
    case ".pdf":
      return "application/pdf";
    case ".txt":
    case ".log":
      return "text/plain";
    case ".md":
      return "text/markdown";
    case ".json":
      return "application/json";
    case ".csv":
      return "text/csv";
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".png":
      return "image/png";
    case ".gif":
      return "image/gif";
    case ".webp":
      return "image/webp";
    case ".mp4":
      return "video/mp4";
    case ".avi":
      return "video/x-msvideo";
    case ".mkv":
      return "video/x-matroska";
    default:
      return "application/octet-stream";
  }
}

async function buildTelegramFileFormData(
  chatId: number,
  filePath: string,
  fieldName: "document" | "photo" | "video",
  caption?: string,
  replyToMessageId?: number,
): Promise<FormData> {
  const buffer = await fs.readFile(filePath);
  const formData = new FormData();
  formData.set("chat_id", String(chatId));
  formData.set(
    fieldName,
    new File([buffer], path.basename(filePath), {
      type: getMimeTypeForPath(filePath),
    }),
  );

  if (caption?.trim()) {
    formData.set("caption", caption.trim());
  }

  if (replyToMessageId !== undefined) {
    formData.set("reply_to_message_id", String(replyToMessageId));
  }

  return formData;
}

async function readTelegramPayload<TResult>(
  response: Response,
): Promise<TelegramApiResponse<TResult> | undefined> {
  const rawBody = await response.text();
  if (!rawBody.trim()) {
    return undefined;
  }

  try {
    return JSON.parse(rawBody) as TelegramApiResponse<TResult>;
  } catch {
    return undefined;
  }
}
