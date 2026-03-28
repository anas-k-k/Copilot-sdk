import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import type { AppConfig } from "../src/config/env.js";
import { Logger } from "../src/logging/logger.js";
import type { ExecText } from "../src/utils/process.js";
import { WebcamCaptureService } from "../src/webcam/webcam-capture-service.js";
import { createTestConfig } from "./test-config.js";

describe("WebcamCaptureService", () => {
  const tempDirectories: string[] = [];

  afterEach(async () => {
    await Promise.all(
      tempDirectories
        .splice(0)
        .map((directory) => rm(directory, { recursive: true, force: true })),
    );
  });

  it("runs the configured webcam capture command and returns the created photo", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "copilot-sdk-webcam-"));
    tempDirectories.push(root);

    let capturedCommand:
      | { command: string; args: string[]; outputPath: string | undefined }
      | undefined;

    const execText: ExecText = async (command, args, options) => {
      capturedCommand = {
        command,
        args,
        outputPath: options?.env?.WEBCAM_OUTPUT_PATH,
      };

      const outputPath = options?.env?.WEBCAM_OUTPUT_PATH;
      if (!outputPath) {
        throw new Error("Missing WEBCAM_OUTPUT_PATH in test execution.");
      }

      await mkdir(path.dirname(outputPath), { recursive: true });
      await writeFile(outputPath, "jpeg-bytes", "utf8");
      return { stdout: "captured", stderr: "" };
    };

    const service = new WebcamCaptureService(
      createConfig(root),
      new Logger("error"),
      execText,
    );
    const result = await service.capturePhoto("user-1");

    expect(capturedCommand?.command).toBe("custom-webcam-capture");
    expect(capturedCommand?.args).toEqual(["--output", result.filePath]);
    expect(capturedCommand?.outputPath).toBe(result.filePath);
    expect(result.filePath).toContain(
      path.join("user-1", "project", ".captures", "webcam"),
    );
    expect(result.fileName).toMatch(/^webcam-.*\.jpg$/);
    expect(result.sizeBytes).toBe(10);
    expect(result.captureMethod).toBe("configured-command");
  });

  it("rejects captures that exceed the send size limit", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "copilot-sdk-webcam-"));
    tempDirectories.push(root);

    const execText: ExecText = async (_command, _args, options) => {
      const outputPath = options?.env?.WEBCAM_OUTPUT_PATH;
      if (!outputPath) {
        throw new Error("Missing WEBCAM_OUTPUT_PATH in test execution.");
      }

      await mkdir(path.dirname(outputPath), { recursive: true });
      await writeFile(outputPath, "0123456789", "utf8");
      return { stdout: "captured", stderr: "" };
    };

    const service = new WebcamCaptureService(
      createConfig(root, { fileSendMaxFileSizeBytes: 5 }),
      new Logger("error"),
      execText,
    );

    await expect(service.capturePhoto("user-2")).rejects.toThrow(
      "Captured photo exceeds the Telegram send limit",
    );
  });
});

function createConfig(
  appUserStateRoot: string,
  overrides: Partial<AppConfig> = {},
): AppConfig {
  return createTestConfig({
    appUserStateRoot,
    webcamCaptureCommand: "custom-webcam-capture",
    webcamCaptureArgs: ["--output", "{outputPath}"],
    ...overrides,
  });
}
