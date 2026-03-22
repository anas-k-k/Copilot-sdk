import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { execFileText } from "../src/utils/process.js";

describe("execFileText", () => {
  let tempDir: string | undefined;

  afterEach(() => {
    if (tempDir) {
      fs.rmSync(tempDir, { recursive: true, force: true });
      tempDir = undefined;
    }
  });

  it("runs local node script entrypoints", async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "copilot-sdk-process-"));
    const scriptPath = path.join(tempDir, "echo-args.mjs");

    fs.writeFileSync(
      scriptPath,
      "console.log(JSON.stringify(process.argv.slice(2)))\n",
      "utf8",
    );

    const result = await execFileText(scriptPath, ["alpha", "two words"]);

    expect(result.stdout.trim()).toBe('["alpha","two words"]');
  });

  it.runIf(process.platform === "win32")(
    "runs Windows command shims through the shell",
    async () => {
      tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "copilot-sdk-process-"));
      const scriptPath = path.join(tempDir, "echo-args.cmd");

      fs.writeFileSync(scriptPath, "@echo off\r\necho %1 %2\r\n", "utf8");

      const result = await execFileText(scriptPath, ["alpha", "beta"]);

      expect(result.stdout.trim()).toBe("alpha beta");
    },
  );
});
