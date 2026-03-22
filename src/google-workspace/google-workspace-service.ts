import type { AppConfig } from "../config/env.js";
import type { Logger } from "../logging/logger.js";
import type { ExecText, ExecTextResult } from "../utils/process.js";
import { execFileText } from "../utils/process.js";
import type {
  GmailConnectionStatus,
  GmailListMessagesRequest,
  GmailMessageDetail,
  GmailMessageListResult,
  GmailMessageSummary,
  GmailSendMessageRequest,
  GmailSendResult,
} from "./types.js";

export class GoogleWorkspaceService {
  public constructor(
    private readonly config: AppConfig,
    private readonly logger: Logger,
    private readonly execText: ExecText = execFileText,
  ) {}

  public isConfigured(): boolean {
    return Boolean(this.config.googleWorkspaceCliCommand);
  }

  public async getGmailConnectionStatus(): Promise<GmailConnectionStatus> {
    if (!this.config.googleWorkspaceCliCommand) {
      return {
        configured: false,
        authCheckConfigured: false,
        baseArgs: this.config.googleWorkspaceCliArgs,
        error:
          "Set GOOGLE_WORKSPACE_CLI_COMMAND and the Gmail command templates before using Gmail tools.",
      };
    }

    const baseStatus: GmailConnectionStatus = {
      configured: true,
      authCheckConfigured: this.config.gmailStatusArgs.length > 0,
      command: this.config.googleWorkspaceCliCommand,
      baseArgs: this.config.googleWorkspaceCliArgs,
    };

    if (this.config.gmailStatusArgs.length === 0) {
      return baseStatus;
    }

    try {
      const result = await this.executeTemplate(
        "gmail status",
        this.config.gmailStatusArgs,
        {},
      );
      const rawOutput = combineOutput(result);
      const parsed = tryParseJson(rawOutput);

      return {
        ...baseStatus,
        authenticated: true,
        rawOutput,
        raw: parsed,
      };
    } catch (error) {
      return {
        ...baseStatus,
        authenticated: false,
        error: getErrorMessage(error),
      };
    }
  }

  public async listGmailMessages(
    request: GmailListMessagesRequest,
  ): Promise<GmailMessageListResult> {
    const maxResults = request.maxResults ?? 10;
    const result = await this.executeTemplate(
      "gmail list",
      this.config.gmailListArgs,
      {
        query: request.query ?? "",
        maxResults: String(maxResults),
      },
    );

    const rawOutput = combineOutput(result);
    const parsed = tryParseJson(rawOutput);
    const messages = normalizeMessageList(parsed, rawOutput);

    return {
      maxResults,
      rawOutput,
      messages,
      ...(request.query ? { query: request.query } : {}),
      ...(parsed !== undefined ? { raw: parsed } : {}),
    };
  }

  public async readGmailMessage(
    messageId: string,
  ): Promise<GmailMessageDetail> {
    const result = await this.executeTemplate(
      "gmail read",
      this.config.gmailReadArgs,
      { messageId },
    );

    const rawOutput = combineOutput(result);
    const parsed = tryParseJson(rawOutput);

    if (isRecord(parsed)) {
      return normalizeMessageDetail(parsed);
    }

    return {
      id: messageId,
      labelIds: [],
      bodyText: rawOutput,
    };
  }

  public async sendGmailMessage(
    request: GmailSendMessageRequest,
  ): Promise<GmailSendResult> {
    const result = await this.executeTemplate(
      "gmail send",
      this.config.gmailSendArgs,
      {
        to: request.to.join(","),
        cc: request.cc?.join(",") ?? "",
        bcc: request.bcc?.join(",") ?? "",
        subject: request.subject,
        body: request.body,
      },
    );

    const rawOutput = combineOutput(result);
    const parsed = tryParseJson(rawOutput);
    const messageId =
      getStringProperty(parsed, "id") ?? getStringProperty(parsed, "messageId");
    const threadId =
      getStringProperty(parsed, "threadId") ??
      getStringProperty(parsed, "conversationId");

    return {
      delivered: true,
      rawOutput,
      ...(messageId ? { messageId } : {}),
      ...(threadId ? { threadId } : {}),
      ...(parsed !== undefined ? { raw: parsed } : {}),
    };
  }

  private async executeTemplate(
    operation: string,
    templateArgs: string[],
    variables: Record<string, string>,
  ): Promise<ExecTextResult> {
    if (!this.config.googleWorkspaceCliCommand) {
      throw new Error("GOOGLE_WORKSPACE_CLI_COMMAND is not configured.");
    }

    if (templateArgs.length === 0) {
      throw new Error(`No command template is configured for ${operation}.`);
    }

    const args = [
      ...this.config.googleWorkspaceCliArgs,
      ...expandTemplateArgs(templateArgs, variables),
    ];

    this.logger.info("Executing Google Workspace CLI command", {
      operation,
      command: this.config.googleWorkspaceCliCommand,
      argsCount: args.length,
    });

    return this.execText(this.config.googleWorkspaceCliCommand, args, {
      cwd: process.cwd(),
      env: {
        ...process.env,
        DISABLE_TELEMETRY: "1",
        DO_NOT_TRACK: "1",
      },
      timeoutMs: this.config.gmailCommandTimeoutMs,
    });
  }
}

function expandTemplateArgs(
  templateArgs: string[],
  variables: Record<string, string>,
): string[] {
  return templateArgs
    .map((arg) =>
      arg.replace(/\{([A-Za-z0-9_]+)\}/g, (_, key: string) => {
        return variables[key] ?? "";
      }),
    )
    .filter((arg) => arg.length > 0)
    .filter((arg) => !isEmptyOptionAssignment(arg));
}

function isEmptyOptionAssignment(arg: string): boolean {
  return /^--[^=\s]+=$/u.test(arg) || /^-[^=\s]=$/u.test(arg);
}

function combineOutput(result: ExecTextResult): string {
  return [result.stdout, result.stderr].filter(Boolean).join("\n").trim();
}

function tryParseJson(value: string): unknown {
  if (!value) {
    return undefined;
  }

  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}

function normalizeMessageList(
  parsed: unknown,
  rawOutput: string,
): GmailMessageSummary[] {
  const items = extractCollection(parsed);
  if (items.length > 0) {
    return items.map((item, index) =>
      normalizeMessageSummary(item, `message-${index + 1}`),
    );
  }

  if (rawOutput) {
    return rawOutput
      .split(/\r?\n/u)
      .map((line) => line.trim())
      .filter(Boolean)
      .slice(0, 20)
      .map((line, index) => ({
        id: `line-${index + 1}`,
        snippet: line,
        labelIds: [],
      }));
  }

  return [];
}

function extractCollection(value: unknown): unknown[] {
  if (Array.isArray(value)) {
    return value;
  }

  if (!isRecord(value)) {
    return [];
  }

  for (const key of ["messages", "items", "result", "data"]) {
    const candidate = value[key];
    if (Array.isArray(candidate)) {
      return candidate;
    }
  }

  return [];
}

function normalizeMessageDetail(
  value: Record<string, unknown>,
): GmailMessageDetail {
  const summary = normalizeMessageSummary(value, "message");
  const cc = firstDefinedString(
    findHeader(value, "cc"),
    getStringProperty(value, "cc"),
  );
  const bcc = firstDefinedString(
    findHeader(value, "bcc"),
    getStringProperty(value, "bcc"),
  );
  const bodyText = extractBodyText(value);
  const bodyHtml = extractBodyHtml(value);

  return {
    ...summary,
    ...(cc ? { cc } : {}),
    ...(bcc ? { bcc } : {}),
    ...(bodyText ? { bodyText } : {}),
    ...(bodyHtml ? { bodyHtml } : {}),
  };
}

function normalizeMessageSummary(
  value: unknown,
  fallbackId: string,
): GmailMessageSummary {
  const record = isRecord(value) ? value : {};
  const threadId =
    getStringProperty(record, "threadId") ??
    getStringProperty(record, "conversationId");
  const from = firstDefinedString(
    findHeader(record, "from"),
    getStringProperty(record, "from"),
  );
  const to = firstDefinedString(
    findHeader(record, "to"),
    getStringProperty(record, "to"),
  );
  const snippet =
    getStringProperty(record, "snippet") ??
    getStringProperty(record, "preview") ??
    getStringProperty(record, "bodyPreview");
  const internalDate =
    getStringProperty(record, "internalDate") ??
    getStringProperty(record, "receivedAt") ??
    getStringProperty(record, "date") ??
    findHeader(record, "date");

  return {
    id:
      getStringProperty(record, "id") ??
      getStringProperty(record, "messageId") ??
      getStringProperty(record, "name") ??
      fallbackId,
    subject:
      firstDefinedString(
        findHeader(record, "subject"),
        getStringProperty(record, "subject"),
      ) ?? "(no subject)",
    labelIds: normalizeStringArray(record.labelIds),
    ...(threadId ? { threadId } : {}),
    ...(from ? { from } : {}),
    ...(to ? { to } : {}),
    ...(snippet ? { snippet } : {}),
    ...(internalDate ? { internalDate } : {}),
    ...(value !== undefined ? { raw: value } : {}),
  };
}

function extractBodyText(value: Record<string, unknown>): string | undefined {
  return firstDefinedString(
    getStringProperty(value, "bodyText"),
    getStringProperty(value, "textBody"),
    getNestedString(value, ["body", "text"]),
    getNestedString(value, ["payload", "body", "data"]),
  );
}

function extractBodyHtml(value: Record<string, unknown>): string | undefined {
  return firstDefinedString(
    getStringProperty(value, "bodyHtml"),
    getNestedString(value, ["body", "html"]),
  );
}

function findHeader(
  value: Record<string, unknown>,
  name: string,
): string | undefined {
  const target = name.toLowerCase();
  const directHeaders = value.headers;
  const payloadHeaders = isRecord(value.payload)
    ? value.payload.headers
    : undefined;

  for (const headers of [directHeaders, payloadHeaders]) {
    const matched = readHeaderValue(headers, target);
    if (matched) {
      return matched;
    }
  }

  return undefined;
}

function readHeaderValue(headers: unknown, target: string): string | undefined {
  if (Array.isArray(headers)) {
    for (const header of headers) {
      if (!isRecord(header)) {
        continue;
      }

      const name = getStringProperty(header, "name");
      if (name?.toLowerCase() === target) {
        return getStringProperty(header, "value");
      }
    }
  }

  if (isRecord(headers)) {
    for (const [key, value] of Object.entries(headers)) {
      if (key.toLowerCase() === target && typeof value === "string") {
        return value;
      }
    }
  }

  return undefined;
}

function getNestedString(
  value: Record<string, unknown>,
  path: string[],
): string | undefined {
  let current: unknown = value;

  for (const key of path) {
    if (!isRecord(current) || !(key in current)) {
      return undefined;
    }

    current = current[key];
  }

  return typeof current === "string" ? current : undefined;
}

function getStringProperty(value: unknown, key: string): string | undefined {
  return isRecord(value) && typeof value[key] === "string"
    ? value[key]
    : undefined;
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((entry): entry is string => typeof entry === "string");
}

function firstDefinedString(
  ...values: Array<string | undefined>
): string | undefined {
  return values.find((value) => Boolean(value));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
