export interface GmailConnectionStatus {
  configured: boolean;
  authCheckConfigured: boolean;
  command?: string;
  baseArgs: string[];
  authenticated?: boolean;
  rawOutput?: string;
  error?: string;
  raw?: unknown;
}

export interface GmailListMessagesRequest {
  query?: string;
  maxResults?: number;
}

export interface GmailMessageSummary {
  id: string;
  threadId?: string;
  from?: string;
  to?: string;
  subject?: string;
  snippet?: string;
  internalDate?: string;
  labelIds: string[];
  raw?: unknown;
}

export interface GmailMessageListResult {
  query?: string;
  maxResults: number;
  rawOutput: string;
  messages: GmailMessageSummary[];
  raw?: unknown;
}

export interface GmailMessageDetail extends GmailMessageSummary {
  cc?: string;
  bcc?: string;
  bodyText?: string;
  bodyHtml?: string;
}

export interface GmailSendMessageRequest {
  to: string[];
  subject: string;
  body: string;
  cc?: string[];
  bcc?: string[];
}

export interface GmailSendResult {
  delivered: boolean;
  messageId?: string;
  threadId?: string;
  rawOutput: string;
  raw?: unknown;
}
