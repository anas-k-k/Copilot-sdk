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
    const buffer = await fs.readFile(filePath);
    const formData = new FormData();
    formData.set("chat_id", String(chatId));
    formData.set("document", new File([buffer], path.basename(filePath)));

    if (caption?.trim()) {
      formData.set("caption", caption.trim());
    }

    if (replyToMessageId !== undefined) {
      formData.set("reply_to_message_id", String(replyToMessageId));
    }

    await this.requestTelegram<true>("sendDocument", {
      method: "POST",
      body: formData,
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
