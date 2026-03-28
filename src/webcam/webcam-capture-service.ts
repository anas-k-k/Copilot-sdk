import { promises as fs } from "node:fs";
import path from "node:path";

import type { AppConfig } from "../config/env.js";
import type { Logger } from "../logging/logger.js";
import type { ExecText } from "../utils/process.js";
import { execFileText } from "../utils/process.js";

export interface WebcamPhotoCaptureResult {
  filePath: string;
  fileName: string;
  sizeBytes: number;
  captureMethod: string;
}

interface ResolvedWebcamExecution {
  command: string;
  args: string[];
  captureMethod: string;
}

export class WebcamCaptureService {
  public constructor(
    private readonly config: AppConfig,
    private readonly logger: Logger,
    private readonly execText: ExecText = execFileText,
  ) {}

  public getCaptureDirectory(userId: string): string {
    return path.join(
      this.config.appUserStateRoot,
      userId,
      "project",
      ".captures",
      "webcam",
    );
  }

  public async capturePhoto(userId: string): Promise<WebcamPhotoCaptureResult> {
    const captureDirectory = this.getCaptureDirectory(userId);
    await fs.mkdir(captureDirectory, { recursive: true });

    const filePath = path.join(
      captureDirectory,
      `webcam-${createTimestampForFileName()}.jpg`,
    );
    const execution = this.resolveExecution(userId, filePath);

    this.logger.info("Capturing webcam photo", {
      userId,
      captureMethod: execution.captureMethod,
      command: execution.command,
    });

    await this.execText(execution.command, execution.args, {
      env: {
        ...process.env,
        WEBCAM_OUTPUT_PATH: filePath,
        WEBCAM_USER_ID: userId,
      },
      timeoutMs: this.config.webcamCaptureTimeoutMs,
    });

    const stats = await fs.stat(filePath).catch(() => undefined);
    if (!stats?.isFile() || stats.size <= 0) {
      throw new Error(
        "Webcam capture did not produce a photo file. Confirm the camera flow completed successfully.",
      );
    }

    if (stats.size > this.config.fileSendMaxFileSizeBytes) {
      throw new Error(
        `Captured photo exceeds the Telegram send limit configured for this app (${this.config.fileSendMaxFileSizeBytes} bytes).`,
      );
    }

    return {
      filePath,
      fileName: path.basename(filePath),
      sizeBytes: stats.size,
      captureMethod: execution.captureMethod,
    };
  }

  private resolveExecution(
    userId: string,
    outputPath: string,
  ): ResolvedWebcamExecution {
    if (this.config.webcamCaptureCommand) {
      return {
        command: this.config.webcamCaptureCommand,
        args: this.config.webcamCaptureArgs.map((arg) =>
          applyTemplate(arg, { outputPath, userId }),
        ),
        captureMethod: "configured-command",
      };
    }

    if (process.platform === "win32") {
      return {
        command: "powershell.exe",
        args: [
          "-NoLogo",
          "-NoProfile",
          "-NonInteractive",
          "-ExecutionPolicy",
          "Bypass",
          "-STA",
          "-Command",
          windowsCameraCaptureScript,
        ],
        captureMethod: "windows-camera-ui",
      };
    }

    throw new Error(
      "No webcam capture command is configured for this platform. Set WEBCAM_CAPTURE_COMMAND and WEBCAM_CAPTURE_ARGS, or run on Windows to use the built-in camera UI flow.",
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

const windowsCameraCaptureScript = [
  '$ErrorActionPreference = "Stop"',
  "Add-Type -AssemblyName System.Runtime.WindowsRuntime",
  "$outputPath = $env:WEBCAM_OUTPUT_PATH",
  'if ([string]::IsNullOrWhiteSpace($outputPath)) { throw "WEBCAM_OUTPUT_PATH is required." }',
  "[void][Windows.Media.Capture.CameraCaptureUI, Windows.Media.Capture, ContentType=WindowsRuntime]",
  "$cameraUi = New-Object Windows.Media.Capture.CameraCaptureUI",
  "$cameraUi.PhotoSettings.Format = [Windows.Media.Capture.CameraCaptureUIPhotoFormat]::Jpeg",
  "$capture = $cameraUi.CaptureFileAsync([Windows.Media.Capture.CameraCaptureUIMode]::Photo)",
  "$capturedFile = $capture.AsTask().GetAwaiter().GetResult()",
  'if ($null -eq $capturedFile) { throw "Camera capture was canceled." }',
  "$targetDirectory = Split-Path -Parent $outputPath",
  "if (-not [string]::IsNullOrWhiteSpace($targetDirectory)) { [System.IO.Directory]::CreateDirectory($targetDirectory) | Out-Null }",
  "[System.IO.File]::Copy($capturedFile.Path, $outputPath, $true)",
].join("; ");
