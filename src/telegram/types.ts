export interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
  callback_query?: TelegramCallbackQuery;
}

export interface TelegramMessage {
  message_id: number;
  text?: string;
  chat: {
    id: number;
  };
  from?: {
    id: number;
    username?: string;
  };
}

export interface TelegramCallbackQuery {
  id: string;
  from: {
    id: number;
    username?: string;
  };
  message?: {
    message_id: number;
    chat: {
      id: number;
    };
  };
  data?: string;
}

export interface TelegramApiResponse<T> {
  ok: boolean;
  result: T;
  description?: string;
  error_code?: number;
}

export interface NormalizedTelegramUpdate {
  updateId: number;
  messageId: number;
  chatId: number;
  userId: string;
  username: string | undefined;
  text: string;
  commandName: string | undefined;
  commandArgs: string | undefined;
  callbackQueryId?: string;
}
