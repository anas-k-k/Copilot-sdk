import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { loadConfig } from "../src/config/env.js";

describe("loadConfig", () => {
  const originalCwd = process.cwd();
  const originalTelegramToken = process.env.TELEGRAM_BOT_TOKEN;
  let tempDir: string | undefined;

  afterEach(() => {
    process.chdir(originalCwd);

    if (originalTelegramToken === undefined) {
      delete process.env.TELEGRAM_BOT_TOKEN;
    } else {
      process.env.TELEGRAM_BOT_TOKEN = originalTelegramToken;
    }

    if (tempDir) {
      fs.rmSync(tempDir, { recursive: true, force: true });
      tempDir = undefined;
    }
  });

  it("applies defaults", () => {
    const config = loadConfig({
      TELEGRAM_BOT_TOKEN: "token",
    });

    expect(config.telegramBotToken).toBe("token");
    expect(config.telegramAllowedUserIds).toEqual([]);
    expect(config.copilotModel).toBe("gpt-5");
    expect(config.copilotRequestTimeoutMs).toBe(180_000);
    expect(config.copilotDelegatedRequestTimeoutMs).toBe(120_000);
    expect(config.skillsCommand).toBe("npx");
    expect(config.skillInstallTimeoutMs).toBe(180_000);
    expect(config.delegatedJobTimeoutMs).toBe(240_000);
    expect(config.messageQueueTimeoutMs).toBe(300_000);
    expect(config.googleWorkspaceCliCommand).toBeUndefined();
    expect(config.gmailListArgs).toEqual([]);
    expect(config.homeMateApiBaseUrl).toBeUndefined();
    expect(config.homeMateSetSwitchStateMethod).toBe("PATCH");
    expect(config.homeMateBulkSetSwitchStateMethod).toBe("POST");
    expect(config.webcamCaptureCommand).toBeUndefined();
    expect(config.webcamCaptureArgs).toEqual([]);
    expect(config.webcamCaptureTimeoutMs).toBe(120_000);
  });

  it("parses allowed Telegram user ids", () => {
    const config = loadConfig({
      TELEGRAM_BOT_TOKEN: "token",
      TELEGRAM_ALLOWED_USER_IDS: "8661077453, 1234567890 777",
    });

    expect(config.telegramAllowedUserIds).toEqual([
      "8661077453",
      "1234567890",
      "777",
    ]);
  });

  it("parses Google Workspace CLI command arguments", () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "copilot-sdk-env-"));
    process.chdir(tempDir);

    const config = loadConfig({
      TELEGRAM_BOT_TOKEN: "token",
      GOOGLE_WORKSPACE_CLI_COMMAND: "gws",
      GOOGLE_WORKSPACE_CLI_ARGS: "--format json",
      GMAIL_LIST_ARGS:
        'gmail +triage --format=json --query="is:unread" --max={maxResults}',
    });

    expect(config.googleWorkspaceCliCommand).toBe("gws");
    expect(config.googleWorkspaceCliArgs).toEqual(["--format", "json"]);
    expect(config.gmailListArgs).toEqual([
      "gmail",
      "+triage",
      "--format=json",
      '--query="is:unread"',
      "--max={maxResults}",
    ]);
  });

  it("parses webcam capture command settings", () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "copilot-sdk-env-"));
    process.chdir(tempDir);

    const config = loadConfig({
      TELEGRAM_BOT_TOKEN: "token",
      WEBCAM_CAPTURE_COMMAND: ".\\tools\\capture.cmd",
      WEBCAM_CAPTURE_ARGS: "--output {outputPath}",
      WEBCAM_CAPTURE_TIMEOUT_MS: "45000",
    });

    expect(config.webcamCaptureCommand).toBe(
      path.resolve(tempDir, ".\\tools\\capture.cmd"),
    );
    expect(config.webcamCaptureArgs).toEqual(["--output", "{outputPath}"]);
    expect(config.webcamCaptureTimeoutMs).toBe(45_000);
  });

  it("prefers the local gws shim when configured with the bare command name", () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "copilot-sdk-env-"));
    const cliName = process.platform === "win32" ? "gws.cmd" : "gws";
    const cliPath = path.join(tempDir, "node_modules", ".bin", cliName);

    fs.mkdirSync(path.dirname(cliPath), { recursive: true });
    fs.writeFileSync(cliPath, "", "utf8");
    process.chdir(tempDir);

    const config = loadConfig({
      TELEGRAM_BOT_TOKEN: "token",
      GOOGLE_WORKSPACE_CLI_COMMAND: "gws",
    });

    expect(config.googleWorkspaceCliCommand).toBe(cliPath);
  });

  it("prefers the local Copilot package loader when configured with the bare command name", () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "copilot-sdk-env-"));
    const cliPath = path.join(
      tempDir,
      "node_modules",
      "@github",
      "copilot",
      "npm-loader.js",
    );

    fs.mkdirSync(path.dirname(cliPath), { recursive: true });
    fs.writeFileSync(cliPath, "", "utf8");
    process.chdir(tempDir);

    const config = loadConfig({
      TELEGRAM_BOT_TOKEN: "token",
      COPILOT_CLI_PATH: "copilot",
    });

    expect(config.copilotCliPath).toBe(cliPath);
  });

  it("falls back to the local npm bin when the Copilot package loader is unavailable", () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "copilot-sdk-env-"));
    const cliName = process.platform === "win32" ? "copilot.cmd" : "copilot";
    const cliPath = path.join(tempDir, "node_modules", ".bin", cliName);

    fs.mkdirSync(path.dirname(cliPath), { recursive: true });
    fs.writeFileSync(cliPath, "", "utf8");
    process.chdir(tempDir);

    const config = loadConfig({
      TELEGRAM_BOT_TOKEN: "token",
      COPILOT_CLI_PATH: "copilot",
    });

    expect(config.copilotCliPath).toBe(cliPath);
  });

  it("resolves explicit relative Copilot CLI paths", () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "copilot-sdk-env-"));
    process.chdir(tempDir);

    const config = loadConfig({
      TELEGRAM_BOT_TOKEN: "token",
      COPILOT_CLI_PATH: ".\\tools\\copilot.cmd",
    });

    expect(config.copilotCliPath).toBe(
      path.resolve(tempDir, ".\\tools\\copilot.cmd"),
    );
  });

  it("throws when the Telegram token is missing", () => {
    expect(() => loadConfig({})).toThrow("Missing TELEGRAM_BOT_TOKEN.");
  });

  it("parses HomeMate API settings", () => {
    const config = loadConfig({
      TELEGRAM_BOT_TOKEN: "token",
      HOMEMATE_API_BASE_URL: "https://api.example.test/v1",
      HOMEMATE_API_TOKEN: "secret",
      HOMEMATE_API_HEADERS: '{"x-home-id":"123"}',
      HOMEMATE_ALLOWED_SWITCH_IDS: "switch-1 switch-2",
      HOMEMATE_SET_SWITCH_STATE_METHOD: "post",
    });

    expect(config.homeMateApiBaseUrl).toBe("https://api.example.test/v1");
    expect(config.homeMateApiToken).toBe("secret");
    expect(config.homeMateApiHeaders).toEqual({ "x-home-id": "123" });
    expect(config.homeMateAllowedSwitchIds).toEqual(["switch-1", "switch-2"]);
    expect(config.homeMateSetSwitchStateMethod).toBe("POST");
  });

  it("loads the Telegram token from a workspace .env file", () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "copilot-sdk-env-"));
    fs.writeFileSync(
      path.join(tempDir, ".env"),
      "TELEGRAM_BOT_TOKEN=dotenv-token\n",
      "utf8",
    );
    process.chdir(tempDir);
    delete process.env.TELEGRAM_BOT_TOKEN;

    const config = loadConfig();

    expect(config.telegramBotToken).toBe("dotenv-token");
  });
});
