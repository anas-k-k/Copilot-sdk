import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import type { CopilotClientOptions } from "@github/copilot-sdk";

type CopilotLogLevel = NonNullable<CopilotClientOptions["logLevel"]>;

export interface AppConfig {
  telegramBotToken: string;
  telegramApiBaseUrl: string;
  telegramPollingTimeoutSeconds: number;
  telegramAllowedUserIds: string[];
  copilotModel: string;
  copilotCliPath: string;
  copilotLogLevel: CopilotLogLevel;
  copilotRequestTimeoutMs: number;
  copilotDelegatedRequestTimeoutMs: number;
  appUserStateRoot: string;
  skillsCommand: string;
  skillsAgent: string;
  skillInstallTimeoutMs: number;
  delegatedJobTimeoutMs: number;
  messageQueueTimeoutMs: number;
  googleWorkspaceCliCommand: string | undefined;
  googleWorkspaceCliArgs: string[];
  gmailStatusArgs: string[];
  gmailListArgs: string[];
  gmailReadArgs: string[];
  gmailSendArgs: string[];
  gmailCommandTimeoutMs: number;
  homeMateApiBaseUrl: string | undefined;
  homeMateApiToken: string | undefined;
  homeMateApiTokenHeader: string;
  homeMateApiTokenPrefix: string;
  homeMateApiHeaders: Record<string, string>;
  homeMateApiTimeoutMs: number;
  homeMateListSwitchesPath: string;
  homeMateGetSwitchPath: string;
  homeMateSetSwitchStatePath: string;
  homeMateSetSwitchStateMethod: string;
  homeMateSetSwitchStateBodyTemplate: string;
  homeMateBulkSetSwitchStatePath: string | undefined;
  homeMateBulkSetSwitchStateMethod: string;
  homeMateBulkSetSwitchStateBodyTemplate: string;
  homeMateAllowedSwitchIds: string[];
  fileSearchRoots: string[];
  fileSearchExcludedRoots: string[];
  fileSearchMaxResults: number;
  fileSearchContentExtensions: string[];
  fileSearchContentMaxFileSizeBytes: number;
  fileSendMaxFileSizeBytes: number;
  webcamCaptureCommand: string | undefined;
  webcamCaptureArgs: string[];
  webcamCaptureTimeoutMs: number;
  webcamVideoCommand: string | undefined;
  webcamVideoArgs: string[];
  webcamVideoMaxDurationMs: number;
  webcamVideoMaxFileSizeBytes: number;
  fileSearchAliases: Record<string, string[]>;
  fileSearchMaxDurationMs: number;
  fileSearchMaxFilesScanned: number;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  if (env === process.env) {
    loadDotEnvFile(env, path.resolve(process.cwd(), ".env"));
  }

  const telegramBotToken = env.TELEGRAM_BOT_TOKEN?.trim();
  if (!telegramBotToken) {
    throw new Error("Missing TELEGRAM_BOT_TOKEN.");
  }

  return {
    telegramBotToken,
    telegramApiBaseUrl:
      env.TELEGRAM_API_BASE_URL?.trim() || "https://api.telegram.org",
    telegramPollingTimeoutSeconds: parsePositiveInteger(
      env.TELEGRAM_POLLING_TIMEOUT_SECONDS,
      30,
      "TELEGRAM_POLLING_TIMEOUT_SECONDS",
    ),
    telegramAllowedUserIds: parseIdentifierList(env.TELEGRAM_ALLOWED_USER_IDS),
    copilotModel: env.COPILOT_MODEL?.trim() || "gpt-5",
    copilotCliPath: resolveCopilotCliPath(env.COPILOT_CLI_PATH),
    copilotLogLevel: parseCopilotLogLevel(env.COPILOT_LOG_LEVEL),
    copilotRequestTimeoutMs: parsePositiveInteger(
      env.COPILOT_REQUEST_TIMEOUT_MS,
      180_000,
      "COPILOT_REQUEST_TIMEOUT_MS",
    ),
    copilotDelegatedRequestTimeoutMs: parsePositiveInteger(
      env.COPILOT_DELEGATED_REQUEST_TIMEOUT_MS,
      120_000,
      "COPILOT_DELEGATED_REQUEST_TIMEOUT_MS",
    ),
    appUserStateRoot: path.resolve(
      env.APP_USER_STATE_ROOT?.trim() || ".\\data\\users",
    ),
    skillsCommand: env.SKILLS_COMMAND?.trim() || "npx",
    skillsAgent: env.SKILLS_AGENT?.trim() || "github-copilot",
    skillInstallTimeoutMs: parsePositiveInteger(
      env.SKILL_INSTALL_TIMEOUT_MS,
      180_000,
      "SKILL_INSTALL_TIMEOUT_MS",
    ),
    delegatedJobTimeoutMs: parsePositiveInteger(
      env.DELEGATED_JOB_TIMEOUT_MS,
      240_000,
      "DELEGATED_JOB_TIMEOUT_MS",
    ),
    messageQueueTimeoutMs: parsePositiveInteger(
      env.MESSAGE_QUEUE_TIMEOUT_MS,
      300_000,
      "MESSAGE_QUEUE_TIMEOUT_MS",
    ),
    googleWorkspaceCliCommand: resolveGoogleWorkspaceCliPath(
      env.GOOGLE_WORKSPACE_CLI_COMMAND,
    ),
    googleWorkspaceCliArgs: parseCommandArguments(
      env.GOOGLE_WORKSPACE_CLI_ARGS,
    ),
    gmailStatusArgs: parseCommandArguments(env.GMAIL_STATUS_ARGS),
    gmailListArgs: parseCommandArguments(env.GMAIL_LIST_ARGS),
    gmailReadArgs: parseCommandArguments(env.GMAIL_READ_ARGS),
    gmailSendArgs: parseCommandArguments(env.GMAIL_SEND_ARGS),
    gmailCommandTimeoutMs: parsePositiveInteger(
      env.GMAIL_COMMAND_TIMEOUT_MS,
      30_000,
      "GMAIL_COMMAND_TIMEOUT_MS",
    ),
    homeMateApiBaseUrl: normalizeOptionalString(env.HOMEMATE_API_BASE_URL),
    homeMateApiToken: normalizeOptionalString(env.HOMEMATE_API_TOKEN),
    homeMateApiTokenHeader:
      normalizeOptionalString(env.HOMEMATE_API_TOKEN_HEADER) || "Authorization",
    homeMateApiTokenPrefix: env.HOMEMATE_API_TOKEN_PREFIX ?? "Bearer ",
    homeMateApiHeaders: parseStringMap(env.HOMEMATE_API_HEADERS),
    homeMateApiTimeoutMs: parsePositiveInteger(
      env.HOMEMATE_API_TIMEOUT_MS,
      15_000,
      "HOMEMATE_API_TIMEOUT_MS",
    ),
    homeMateListSwitchesPath:
      normalizeOptionalString(env.HOMEMATE_LIST_SWITCHES_PATH) || "/devices",
    homeMateGetSwitchPath:
      normalizeOptionalString(env.HOMEMATE_GET_SWITCH_PATH) ||
      "/devices/{deviceId}",
    homeMateSetSwitchStatePath:
      normalizeOptionalString(env.HOMEMATE_SET_SWITCH_STATE_PATH) ||
      "/devices/{deviceId}",
    homeMateSetSwitchStateMethod: parseHttpMethod(
      env.HOMEMATE_SET_SWITCH_STATE_METHOD,
      "PATCH",
      "HOMEMATE_SET_SWITCH_STATE_METHOD",
    ),
    homeMateSetSwitchStateBodyTemplate:
      env.HOMEMATE_SET_SWITCH_STATE_BODY_TEMPLATE || '{"state":"{state}"}',
    homeMateBulkSetSwitchStatePath: normalizeOptionalString(
      env.HOMEMATE_BULK_SET_SWITCH_STATE_PATH,
    ),
    homeMateBulkSetSwitchStateMethod: parseHttpMethod(
      env.HOMEMATE_BULK_SET_SWITCH_STATE_METHOD,
      "POST",
      "HOMEMATE_BULK_SET_SWITCH_STATE_METHOD",
    ),
    homeMateBulkSetSwitchStateBodyTemplate:
      env.HOMEMATE_BULK_SET_SWITCH_STATE_BODY_TEMPLATE ||
      '{"deviceIds":{deviceIdsJson},"state":"{state}"}',
    homeMateAllowedSwitchIds: parseIdentifierList(
      env.HOMEMATE_ALLOWED_SWITCH_IDS,
    ),
    fileSearchRoots: parsePathList(
      env.FILE_SEARCH_ROOTS,
      defaultFileSearchRoots(),
    ),
    fileSearchExcludedRoots: parsePathList(
      env.FILE_SEARCH_EXCLUDED_ROOTS,
      defaultFileSearchExcludedRoots(),
    ),
    fileSearchMaxResults: parsePositiveInteger(
      env.FILE_SEARCH_MAX_RESULTS,
      10,
      "FILE_SEARCH_MAX_RESULTS",
    ),
    fileSearchContentExtensions: parseExtensionList(
      env.FILE_SEARCH_CONTENT_EXTENSIONS,
      [".txt", ".md", ".json", ".csv", ".log", ".pdf"],
    ),
    fileSearchContentMaxFileSizeBytes: parsePositiveInteger(
      env.FILE_SEARCH_CONTENT_MAX_FILE_SIZE_BYTES,
      1_000_000,
      "FILE_SEARCH_CONTENT_MAX_FILE_SIZE_BYTES",
    ),
    fileSendMaxFileSizeBytes: parsePositiveInteger(
      env.FILE_SEND_MAX_FILE_SIZE_BYTES,
      10 * 1024 * 1024,
      "FILE_SEND_MAX_FILE_SIZE_BYTES",
    ),
    webcamCaptureCommand: resolveExecutablePath(env.WEBCAM_CAPTURE_COMMAND),
    webcamCaptureArgs: parseCommandArguments(env.WEBCAM_CAPTURE_ARGS),
    webcamCaptureTimeoutMs: parsePositiveInteger(
      env.WEBCAM_CAPTURE_TIMEOUT_MS,
      120_000,
      "WEBCAM_CAPTURE_TIMEOUT_MS",
    ),
    webcamVideoCommand: resolveExecutablePath(env.WEBCAM_VIDEO_COMMAND),
    webcamVideoArgs: parseCommandArguments(env.WEBCAM_VIDEO_ARGS),
    webcamVideoMaxDurationMs: parsePositiveInteger(
      env.WEBCAM_VIDEO_MAX_DURATION_MS,
      300_000,
      "WEBCAM_VIDEO_MAX_DURATION_MS",
    ),
    webcamVideoMaxFileSizeBytes: parsePositiveInteger(
      env.WEBCAM_VIDEO_MAX_FILE_SIZE_BYTES,
      50 * 1024 * 1024,
      "WEBCAM_VIDEO_MAX_FILE_SIZE_BYTES",
    ),
    fileSearchAliases: parseAliasMap(env.FILE_SEARCH_ALIASES),
    fileSearchMaxDurationMs: parsePositiveInteger(
      env.FILE_SEARCH_MAX_DURATION_MS,
      15_000,
      "FILE_SEARCH_MAX_DURATION_MS",
    ),
    fileSearchMaxFilesScanned: parsePositiveInteger(
      env.FILE_SEARCH_MAX_FILES_SCANNED,
      20_000,
      "FILE_SEARCH_MAX_FILES_SCANNED",
    ),
  };
}

function resolveExecutablePath(
  rawValue: string | undefined,
): string | undefined {
  const configuredValue = normalizeOptionalString(rawValue);
  if (!configuredValue) {
    return undefined;
  }

  if (isFilePath(configuredValue)) {
    return path.resolve(configuredValue);
  }

  return configuredValue;
}

function resolveCopilotCliPath(rawValue: string | undefined): string {
  const configuredValue = rawValue?.trim();
  const localCliPath = findLocalCommandPath("copilot", {
    packageLoaderSegments: ["@github", "copilot", "npm-loader.js"],
  });

  if (!configuredValue || configuredValue.toLowerCase() === "copilot") {
    return localCliPath || configuredValue || "copilot";
  }

  if (isFilePath(configuredValue)) {
    return path.resolve(configuredValue);
  }

  return configuredValue;
}

function resolveGoogleWorkspaceCliPath(
  rawValue: string | undefined,
): string | undefined {
  const configuredValue = normalizeOptionalString(rawValue);
  if (!configuredValue) {
    return undefined;
  }

  const localCliPath = findLocalCommandPath("gws");

  if (configuredValue.toLowerCase() === "gws") {
    return localCliPath || configuredValue;
  }

  if (isFilePath(configuredValue)) {
    return path.resolve(configuredValue);
  }

  return configuredValue;
}

function findLocalCommandPath(
  commandName: string,
  options: {
    packageLoaderSegments?: string[];
  } = {},
): string | undefined {
  if (options.packageLoaderSegments) {
    const packageLoaderPath = path.resolve(
      process.cwd(),
      "node_modules",
      ...options.packageLoaderSegments,
    );

    if (fs.existsSync(packageLoaderPath)) {
      return packageLoaderPath;
    }
  }

  const nodeModulesBin = path.resolve(process.cwd(), "node_modules", ".bin");
  const candidateNames =
    process.platform === "win32"
      ? [`${commandName}.cmd`, `${commandName}.exe`, commandName]
      : [commandName];

  for (const candidateName of candidateNames) {
    const candidatePath = path.join(nodeModulesBin, candidateName);
    if (fs.existsSync(candidatePath)) {
      return candidatePath;
    }
  }

  return undefined;
}

function isFilePath(value: string): boolean {
  return (
    value.includes("/") ||
    value.includes("\\") ||
    path.isAbsolute(value) ||
    value.startsWith(".")
  );
}

function normalizeOptionalString(
  value: string | undefined,
): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function parseIdentifierList(rawValue: string | undefined): string[] {
  const value = rawValue?.trim();
  if (!value) {
    return [];
  }

  return value
    .split(/[\s,]+/u)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function parseStringMap(rawValue: string | undefined): Record<string, string> {
  const value = rawValue?.trim();
  if (!value) {
    return {};
  }

  try {
    const parsed = JSON.parse(value) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return Object.fromEntries(
        Object.entries(parsed).flatMap(([key, entryValue]) =>
          typeof entryValue === "string" && key.trim()
            ? [[key.trim(), entryValue]]
            : [],
        ),
      );
    }
  } catch {
    // Fall through to delimiter-based parsing.
  }

  return Object.fromEntries(
    value
      .split(/[;\n]+/u)
      .map((entry) => entry.split("="))
      .flatMap(([key, entryValue]) => {
        const normalizedKey = key?.trim();
        const normalizedValue = entryValue?.trim();
        return normalizedKey && normalizedValue
          ? [[normalizedKey, normalizedValue]]
          : [];
      }),
  );
}

function parseHttpMethod(
  rawValue: string | undefined,
  fallback: string,
  envName: string,
): string {
  const normalized = rawValue?.trim().toUpperCase() || fallback;
  if (["GET", "POST", "PUT", "PATCH", "DELETE"].includes(normalized)) {
    return normalized;
  }

  throw new Error(`Invalid ${envName}: ${rawValue}`);
}

function parsePathList(
  rawValue: string | undefined,
  fallback: string[],
): string[] {
  const value = rawValue?.trim();
  if (!value) {
    return fallback;
  }

  return value
    .split(/[;,\n]+/u)
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => path.resolve(entry));
}

function parseExtensionList(
  rawValue: string | undefined,
  fallback: string[],
): string[] {
  const value = rawValue?.trim();
  if (!value) {
    return fallback;
  }

  return value
    .split(/[\s,;]+/u)
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean)
    .map((entry) => (entry.startsWith(".") ? entry : `.${entry}`));
}

function parseAliasMap(rawValue: string | undefined): Record<string, string[]> {
  const aliases: Record<string, string[]> = {
    adhar: ["aadhaar", "aadhar"],
    aadhaar: ["adhar", "aadhar"],
    aadhar: ["aadhaar", "adhar"],
  };

  const value = rawValue?.trim();
  if (!value) {
    return aliases;
  }

  for (const entry of value.split(/[;\n]+/u)) {
    const [source, targets] = entry.split("=");
    const sourceKey = source?.trim().toLowerCase();
    if (!sourceKey || !targets?.trim()) {
      continue;
    }

    aliases[sourceKey] = targets
      .split(",")
      .map((target) => target.trim().toLowerCase())
      .filter(Boolean);
  }

  return aliases;
}

function parseCopilotLogLevel(rawValue: string | undefined): CopilotLogLevel {
  const value = rawValue?.trim();
  if (!value) {
    return "info";
  }

  if (isCopilotLogLevel(value)) {
    return value;
  }

  throw new Error(
    "COPILOT_LOG_LEVEL must be one of none, error, warning, info, debug, or all.",
  );
}

function isCopilotLogLevel(value: string): value is CopilotLogLevel {
  return ["none", "error", "warning", "info", "debug", "all"].includes(value);
}

function parsePositiveInteger(
  rawValue: string | undefined,
  fallback: number,
  name: string,
): number {
  if (!rawValue?.trim()) {
    return fallback;
  }

  const value = Number.parseInt(rawValue, 10);
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer.`);
  }

  return value;
}

function loadDotEnvFile(env: NodeJS.ProcessEnv, filePath: string): void {
  if (!fs.existsSync(filePath)) {
    return;
  }

  const fileContents = fs.readFileSync(filePath, "utf8");

  for (const rawLine of fileContents.split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }

    const normalizedLine = line.startsWith("export ")
      ? line.slice(7).trim()
      : line;
    const separatorIndex = normalizedLine.indexOf("=");
    if (separatorIndex <= 0) {
      continue;
    }

    const key = normalizedLine.slice(0, separatorIndex).trim();
    if (!key || env[key] !== undefined) {
      continue;
    }

    let value = normalizedLine.slice(separatorIndex + 1).trim();
    if (
      value.length >= 2 &&
      ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'")))
    ) {
      value = value.slice(1, -1);
    }

    env[key] = value;
  }
}

function parseCommandArguments(rawValue: string | undefined): string[] {
  const value = rawValue?.trim();
  if (!value) {
    return [];
  }

  const matches = value.match(/"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|[^\s]+/g);
  if (!matches) {
    return [];
  }

  return matches.map((token) => {
    if (
      token.length >= 2 &&
      ((token.startsWith('"') && token.endsWith('"')) ||
        (token.startsWith("'") && token.endsWith("'")))
    ) {
      return token
        .slice(1, -1)
        .replace(/\\"/g, '"')
        .replace(/\\'/g, "'")
        .replace(/\\\\/g, "\\");
    }

    return token;
  });
}

function defaultFileSearchRoots(): string[] {
  if (process.platform === "win32") {
    const homeDirectory = os.homedir();
    const prioritizedRoots = [
      path.join(homeDirectory, "Desktop"),
      path.join(homeDirectory, "Documents"),
      path.join(homeDirectory, "Downloads"),
      path.join(homeDirectory, "Pictures"),
      homeDirectory,
      path.resolve("C:\\"),
    ];

    return prioritizedRoots.filter((root, index, values) => {
      const normalizedRoot = path.resolve(root).toLowerCase();
      return (
        values.findIndex(
          (candidate) =>
            path.resolve(candidate).toLowerCase() === normalizedRoot,
        ) === index
      );
    });
  }

  return [path.resolve(path.sep)];
}

function defaultFileSearchExcludedRoots(): string[] {
  if (process.platform === "win32") {
    return [
      path.resolve("C:\\Windows"),
      path.resolve("C:\\Program Files"),
      path.resolve("C:\\Program Files (x86)"),
      path.resolve("C:\\ProgramData"),
      path.resolve("C:\\$Recycle.Bin"),
    ];
  }

  return [];
}
