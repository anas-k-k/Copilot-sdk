import { type ChildProcess, spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";

import type { AppConfig } from "../config/env.js";
import type { Logger } from "../logging/logger.js";

export interface ActiveVideoRecording {
  userId: string;
  filePath: string;
  startedAt: Date;
  process: ChildProcess;
  maxDurationTimer: ReturnType<typeof setTimeout>;
}

export interface VideoRecordingResult {
  filePath: string;
  fileName: string;
  sizeBytes: number;
  durationMs: number;
  recordingMethod: string;
}

interface ResolvedVideoExecution {
  command: string;
  args: string[];
  recordingMethod: string;
}

export class WebcamVideoService {
  private readonly activeRecordings = new Map<string, ActiveVideoRecording>();

  public constructor(
    private readonly config: AppConfig,
    private readonly logger: Logger,
  ) {}

  public getRecordingDirectory(userId: string): string {
    return path.join(
      this.config.appUserStateRoot,
      userId,
      "project",
      ".captures",
      "video",
    );
  }

  public hasActiveRecording(userId: string): boolean {
    return this.activeRecordings.has(userId);
  }

  public async startRecording(userId: string): Promise<{ filePath: string }> {
    if (this.activeRecordings.has(userId)) {
      throw new Error(
        "A video recording is already in progress for this user. Stop the current recording before starting a new one.",
      );
    }

    const recordingDirectory = this.getRecordingDirectory(userId);
    await fs.mkdir(recordingDirectory, { recursive: true });

    const filePath = path.join(
      recordingDirectory,
      `webcam-${createTimestampForFileName()}.mp4`,
    );
    const execution = this.resolveExecution(userId, filePath);

    this.logger.info("Starting webcam video recording", {
      userId,
      recordingMethod: execution.recordingMethod,
      command: execution.command,
      filePath,
    });

    const child = spawn(execution.command, execution.args, {
      env: {
        ...process.env,
        WEBCAM_OUTPUT_PATH: filePath,
        WEBCAM_USER_ID: userId,
      },
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });

    const startedAt = new Date();

    const maxDurationTimer = setTimeout(() => {
      this.logger.warn(
        "Video recording reached max duration, stopping automatically",
        { userId, maxDurationMs: this.config.webcamVideoMaxDurationMs },
      );
      void this.stopRecording(userId).catch((error) => {
        this.logger.error("Failed to auto-stop video recording", {
          userId,
          error: error instanceof Error ? error.message : String(error),
        });
      });
    }, this.config.webcamVideoMaxDurationMs);

    const recording: ActiveVideoRecording = {
      userId,
      filePath,
      startedAt,
      process: child,
      maxDurationTimer,
    };

    this.activeRecordings.set(userId, recording);

    child.on("error", (error) => {
      this.logger.error("Video recording process error", {
        userId,
        error: error.message,
      });
      this.cleanupRecording(userId);
    });

    child.on("exit", (code) => {
      if (this.activeRecordings.has(userId)) {
        this.logger.info("Video recording process exited on its own", {
          userId,
          exitCode: code,
          filePath: recording.filePath,
        });
        // Do NOT remove from activeRecordings here.
        // The recording file may still be valid and the user can
        // say "stop" to retrieve whatever was captured.
        clearTimeout(recording.maxDurationTimer);
      }
    });

    return { filePath };
  }

  public async stopRecording(userId: string): Promise<VideoRecordingResult> {
    const recording = this.activeRecordings.get(userId);
    if (!recording) {
      throw new Error(
        "No active video recording found for this user. Start a recording first.",
      );
    }

    clearTimeout(recording.maxDurationTimer);
    const durationMs = Date.now() - recording.startedAt.getTime();

    this.logger.info("Stopping webcam video recording", {
      userId,
      filePath: recording.filePath,
      durationMs,
    });

    await this.terminateProcess(recording.process);
    this.activeRecordings.delete(userId);

    // Give a short grace period for the file to be finalized
    await delay(500);

    const stats = await fs.stat(recording.filePath).catch(() => undefined);
    if (!stats?.isFile() || stats.size <= 0) {
      throw new Error(
        "Video recording did not produce a video file. The recording may have been too short or the command failed.",
      );
    }

    if (stats.size > this.config.webcamVideoMaxFileSizeBytes) {
      throw new Error(
        `Recorded video exceeds the Telegram send limit configured for this app (${this.config.webcamVideoMaxFileSizeBytes} bytes). Try a shorter recording.`,
      );
    }

    return {
      filePath: recording.filePath,
      fileName: path.basename(recording.filePath),
      sizeBytes: stats.size,
      durationMs,
      recordingMethod: this.config.webcamVideoCommand
        ? "configured-command"
        : "windows-ffmpeg",
    };
  }

  public stopAll(): void {
    for (const [userId] of this.activeRecordings) {
      void this.stopRecording(userId).catch((error) => {
        this.logger.error("Failed to stop recording during cleanup", {
          userId,
          error: error instanceof Error ? error.message : String(error),
        });
      });
    }
  }

  private cleanupRecording(userId: string): void {
    const recording = this.activeRecordings.get(userId);
    if (recording) {
      clearTimeout(recording.maxDurationTimer);
      this.activeRecordings.delete(userId);
    }
  }

  private async terminateProcess(child: ChildProcess): Promise<void> {
    if (child.exitCode !== null) {
      return;
    }

    // Send SIGINT first (graceful) then force kill after a timeout.
    // On Windows, sending "q\n" to stdin works for ffmpeg.
    if (process.platform === "win32") {
      try {
        child.stdin?.write("q\n");
        child.stdin?.end();
      } catch {
        // stdin may already be closed
      }
    } else {
      child.kill("SIGINT");
    }

    const exited = await Promise.race([
      new Promise<boolean>((resolve) => {
        child.on("exit", () => resolve(true));
      }),
      delay(5000).then(() => false),
    ]);

    if (!exited && child.exitCode === null) {
      child.kill("SIGKILL");
    }
  }

  private resolveExecution(
    userId: string,
    outputPath: string,
  ): ResolvedVideoExecution {
    if (this.config.webcamVideoCommand) {
      return {
        command: this.config.webcamVideoCommand,
        args: this.config.webcamVideoArgs.map((arg) =>
          applyTemplate(arg, { outputPath, userId }),
        ),
        recordingMethod: "configured-command",
      };
    }

    if (process.platform === "win32") {
      return {
        command: "ffmpeg",
        args: [
          "-f",
          "dshow",
          "-i",
          "video=Integrated Webcam",
          "-c:v",
          "libx264",
          "-preset",
          "ultrafast",
          "-y",
          outputPath,
        ],
        recordingMethod: "windows-ffmpeg",
      };
    }

    throw new Error(
      "No webcam video command is configured for this platform. Set WEBCAM_VIDEO_COMMAND and WEBCAM_VIDEO_ARGS, or run on Windows with ffmpeg available.",
    );
  }
}

function applyTemplate(
  template: string,
  values: Record<string, string>,
): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) => {
    return values[key] ?? match;
  });
}

function createTimestampForFileName(): string {
  return new Date()
    .toISOString()
    .replace(/[\-:.]/g, "")
    .replace("Z", "");
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
