import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import type { AppConfig } from "../src/config/env.js";
import { Logger } from "../src/logging/logger.js";
import { WebcamVideoService } from "../src/webcam/webcam-video-service.js";
import { createTestConfig } from "./test-config.js";

describe("WebcamVideoService", () => {
  const tempDirectories: string[] = [];

  afterEach(async () => {
    await Promise.all(
      tempDirectories
        .splice(0)
        .map((directory) => rm(directory, { recursive: true, force: true })),
    );
  });

  it("tracks active recordings correctly", () => {
    const service = new WebcamVideoService(
      createConfig(os.tmpdir()),
      new Logger("error"),
    );

    expect(service.hasActiveRecording("user-1")).toBe(false);
  });

  it("returns the correct recording directory for a user", () => {
    const root = "C:\\temp";
    const service = new WebcamVideoService(
      createConfig(root),
      new Logger("error"),
    );

    expect(service.getRecordingDirectory("user-1")).toBe(
      path.join(root, "user-1", "project", ".captures", "video"),
    );
  });

  it("rejects starting a duplicate recording for the same user", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "copilot-sdk-video-"));
    tempDirectories.push(root);

    const service = new WebcamVideoService(
      createConfig(root),
      new Logger("error"),
    );

    // Start a mock recording by manipulating the internal state
    // We need to use the real startRecording, which spawns a process
    // Instead, test the guard by starting and immediately trying again
    // Use a long-running dummy command
    const configWithCommand = createConfig(root, {
      webcamVideoCommand:
        process.platform === "win32" ? "cmd.exe" : "/bin/cat",
      webcamVideoArgs:
        process.platform === "win32" ? ["/c", "pause"] : ["/dev/null"],
    });

    const serviceWithCmd = new WebcamVideoService(
      configWithCommand,
      new Logger("error"),
    );

    await serviceWithCmd.startRecording("user-1");
    expect(serviceWithCmd.hasActiveRecording("user-1")).toBe(true);

    await expect(serviceWithCmd.startRecording("user-1")).rejects.toThrow(
      "A video recording is already in progress",
    );

    // Clean up
    serviceWithCmd.stopAll();
  });

  it("rejects stopping when no recording is active", async () => {
    const service = new WebcamVideoService(
      createConfig(os.tmpdir()),
      new Logger("error"),
    );

    await expect(service.stopRecording("user-1")).rejects.toThrow(
      "No active video recording found",
    );
  });
});

function createConfig(
  appUserStateRoot: string,
  overrides: Partial<AppConfig> = {},
): AppConfig {
  return createTestConfig({
    appUserStateRoot,
    webcamVideoCommand: undefined,
    webcamVideoArgs: [],
    webcamVideoMaxDurationMs: 300_000,
    ...overrides,
  });
}
