import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import type { AppConfig } from "../src/config/env.js";
import { FileSearchService } from "../src/files/file-search-service.js";
import { Logger } from "../src/logging/logger.js";

describe("FileSearchService", () => {
  it("matches loose filename variants for adhar-style queries", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "file-search-"));
    const filePath = path.join(root, "IDs", "aadhaar-card-front.jpg");
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, "binary-placeholder", "utf8");

    const service = new FileSearchService(
      createConfig(root),
      new Logger("error"),
    );
    const result = await service.searchFiles("my adhar card image or doc");

    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]?.absolutePath).toBe(filePath);
    expect(result.candidates[0]?.matchReason).toBe("filename");
  });

  it("matches supported document content when the filename is generic", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "file-search-"));
    const filePath = path.join(root, "docs", "identity-notes.txt");
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(
      filePath,
      "Customer submitted Aadhaar card and bank statement for verification.",
      "utf8",
    );

    const service = new FileSearchService(
      createConfig(root),
      new Logger("error"),
    );
    const result = await service.searchFiles("adhar card");

    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]?.absolutePath).toBe(filePath);
    expect(result.candidates[0]?.matchReason).toBe("content");
  });

  it("skips excluded roots and oversized files", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "file-search-"));
    const excludedRoot = path.join(root, "excluded");
    const includedRoot = path.join(root, "included");
    await mkdir(excludedRoot, { recursive: true });
    await mkdir(includedRoot, { recursive: true });

    await writeFile(path.join(excludedRoot, "aadhaar.txt"), "aadhaar", "utf8");
    await writeFile(
      path.join(includedRoot, "aadhaar-large.txt"),
      "x".repeat(2048),
      "utf8",
    );

    const service = new FileSearchService(
      createConfig(includedRoot, {
        fileSearchExcludedRoots: [excludedRoot],
        fileSendMaxFileSizeBytes: 1024,
      }),
      new Logger("error"),
    );
    const result = await service.searchFiles("aadhaar");

    expect(result.candidates).toHaveLength(0);
  });
});

function createConfig(
  root: string,
  overrides: Partial<AppConfig> = {},
): AppConfig {
  return {
    telegramBotToken: "token",
    telegramApiBaseUrl: "https://api.telegram.org",
    telegramPollingTimeoutSeconds: 30,
    telegramAllowedUserIds: [],
    copilotModel: "gpt-5",
    copilotCliPath: "copilot",
    copilotLogLevel: "info",
    appUserStateRoot: root,
    skillsCommand: "npx",
    skillsAgent: "github-copilot",
    googleWorkspaceCliCommand: undefined,
    googleWorkspaceCliArgs: [],
    gmailStatusArgs: [],
    gmailListArgs: [],
    gmailReadArgs: [],
    gmailSendArgs: [],
    gmailCommandTimeoutMs: 30_000,
    fileSearchRoots: [root],
    fileSearchExcludedRoots: [],
    fileSearchMaxResults: 10,
    fileSearchContentExtensions: [".txt", ".md", ".json", ".csv", ".log"],
    fileSearchContentMaxFileSizeBytes: 1_000_000,
    fileSendMaxFileSizeBytes: 10 * 1024 * 1024,
    fileSearchAliases: {
      adhar: ["aadhaar", "aadhar"],
      aadhaar: ["adhar", "aadhar"],
      aadhar: ["aadhaar", "adhar"],
    },
    fileSearchMaxDurationMs: 15_000,
    fileSearchMaxFilesScanned: 20_000,
    ...overrides,
  };
}
