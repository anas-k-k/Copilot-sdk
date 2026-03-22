import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

import type { AppConfig } from "../config/env.js";
import type { Logger } from "../logging/logger.js";

export type FileMatchReason = "filename" | "path" | "content";

export interface FileSearchCandidate {
  absolutePath: string;
  displayPath: string;
  fileName: string;
  extension: string;
  sizeBytes: number;
  modifiedAt: string;
  matchReason: FileMatchReason;
}

export interface FileSearchResult {
  query: string;
  normalizedQuery: string;
  candidates: FileSearchCandidate[];
}

interface RankedCandidate {
  candidate: FileSearchCandidate;
  score: number;
}

interface NormalizedQuery {
  raw: string;
  normalized: string;
  tokenGroups: string[][];
}

interface SearchBudget {
  readonly startedAt: number;
  readonly deadline: number;
  scannedFiles: number;
}

type ContentReader = (filePath: string) => Promise<string | undefined>;

interface ContentReaders {
  readTextFile: ContentReader;
  readPdfFile: ContentReader;
}

const controlCharacterPattern = /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/gu;
const ignoredQueryTokens = new Set([
  "a",
  "an",
  "and",
  "copy",
  "doc",
  "document",
  "file",
  "image",
  "me",
  "my",
  "or",
  "please",
  "send",
  "the",
]);

export class FileSearchService {
  private readonly contentReaders: ContentReaders;

  public constructor(
    private readonly config: AppConfig,
    private readonly logger: Logger,
    contentReaders?: Partial<ContentReaders>,
  ) {
    this.contentReaders = {
      readTextFile:
        contentReaders?.readTextFile ??
        ((filePath) => this.readTextFile(filePath)),
      readPdfFile:
        contentReaders?.readPdfFile ??
        ((filePath) => this.readPdfFile(filePath)),
    };
  }

  public async searchFiles(query: string): Promise<FileSearchResult> {
    const normalizedQuery = this.normalizeQuery(query);
    if (!normalizedQuery.normalized) {
      throw new Error("File search query cannot be empty.");
    }

    const rankedCandidates: RankedCandidate[] = [];
    const seenPaths = new Set<string>();
    const seenDirectories = new Set<string>();
    const budget: SearchBudget = {
      startedAt: Date.now(),
      deadline: Date.now() + this.config.fileSearchMaxDurationMs,
      scannedFiles: 0,
    };
    const directoryQueue = this.buildDirectoryQueue();

    while (directoryQueue.length > 0) {
      if (this.isBudgetExhausted(budget)) {
        this.logger.info(
          "File search stopped early after reaching search budget",
          {
            query: normalizedQuery.raw,
            elapsedMs: Date.now() - budget.startedAt,
            scannedFiles: budget.scannedFiles,
            candidates: rankedCandidates.length,
          },
        );
        break;
      }

      const directoryPath = directoryQueue.shift();
      if (!directoryPath) {
        break;
      }

      const normalizedDirectoryPath = normalizeForComparison(directoryPath);
      if (
        seenDirectories.has(normalizedDirectoryPath) ||
        this.isExcludedPath(directoryPath)
      ) {
        continue;
      }

      seenDirectories.add(normalizedDirectoryPath);
      await this.walkDirectory(
        directoryPath,
        normalizedQuery,
        rankedCandidates,
        seenPaths,
        directoryQueue,
        budget,
      );

      if (rankedCandidates.length >= this.config.fileSearchMaxResults) {
        break;
      }
    }

    rankedCandidates.sort((left, right) => {
      if (right.score !== left.score) {
        return right.score - left.score;
      }

      return right.candidate.modifiedAt.localeCompare(
        left.candidate.modifiedAt,
      );
    });

    return {
      query: query.trim(),
      normalizedQuery: normalizedQuery.normalized,
      candidates: rankedCandidates
        .slice(0, this.config.fileSearchMaxResults)
        .map((entry) => entry.candidate),
    };
  }

  public async getSendableFile(filePath: string): Promise<FileSearchCandidate> {
    const absolutePath = path.resolve(filePath);
    if (this.isExcludedPath(absolutePath)) {
      throw new Error("Requested file is in an excluded location.");
    }

    const stats = await fs.stat(absolutePath);
    if (!stats.isFile()) {
      throw new Error("Requested path is not a file.");
    }

    if (stats.size > this.config.fileSendMaxFileSizeBytes) {
      throw new Error(
        "Requested file exceeds the configured Telegram upload limit.",
      );
    }

    return {
      absolutePath,
      displayPath: absolutePath,
      fileName: path.basename(absolutePath),
      extension: path.extname(absolutePath).toLowerCase(),
      sizeBytes: stats.size,
      modifiedAt: stats.mtime.toISOString(),
      matchReason: "path",
    };
  }

  private async walkDirectory(
    directoryPath: string,
    normalizedQuery: NormalizedQuery,
    rankedCandidates: RankedCandidate[],
    seenPaths: Set<string>,
    directoryQueue: string[],
    budget: SearchBudget,
  ): Promise<void> {
    if (this.isExcludedPath(directoryPath) || this.isBudgetExhausted(budget)) {
      return;
    }

    let entries;
    try {
      entries = await fs.readdir(directoryPath, { withFileTypes: true });
    } catch (error) {
      this.logger.debug("Skipping unreadable directory during file search", {
        directoryPath,
        error: error instanceof Error ? error.message : String(error),
      });
      return;
    }

    for (const entry of entries) {
      if (this.isBudgetExhausted(budget)) {
        return;
      }

      const entryPath = path.join(directoryPath, entry.name);
      if (entry.isDirectory()) {
        if (!this.isExcludedPath(entryPath)) {
          directoryQueue.push(entryPath);
        }
        continue;
      }

      if (!entry.isFile()) {
        continue;
      }

      budget.scannedFiles += 1;

      const rankedCandidate = await this.evaluateFile(
        entryPath,
        normalizedQuery,
      );
      if (!rankedCandidate) {
        continue;
      }

      if (seenPaths.has(rankedCandidate.candidate.absolutePath)) {
        continue;
      }

      seenPaths.add(rankedCandidate.candidate.absolutePath);
      rankedCandidates.push(rankedCandidate);
      if (rankedCandidates.length >= this.config.fileSearchMaxResults) {
        return;
      }
    }
  }

  private buildDirectoryQueue(): string[] {
    const normalizedRoots = this.config.fileSearchRoots.map((root) =>
      path.resolve(root),
    );
    const homeDirectory = normalizeForComparison(os.homedir());

    return normalizedRoots.sort((left, right) => {
      const leftIsHome = normalizeForComparison(left).startsWith(homeDirectory);
      const rightIsHome =
        normalizeForComparison(right).startsWith(homeDirectory);

      if (leftIsHome === rightIsHome) {
        return left.localeCompare(right);
      }

      return leftIsHome ? -1 : 1;
    });
  }

  private isBudgetExhausted(budget: SearchBudget): boolean {
    return (
      Date.now() >= budget.deadline ||
      budget.scannedFiles >= this.config.fileSearchMaxFilesScanned
    );
  }

  private async evaluateFile(
    filePath: string,
    normalizedQuery: NormalizedQuery,
  ): Promise<RankedCandidate | undefined> {
    let stats;
    try {
      stats = await fs.stat(filePath);
    } catch {
      return undefined;
    }

    if (!stats.isFile() || stats.size > this.config.fileSendMaxFileSizeBytes) {
      return undefined;
    }

    const fileName = path.basename(filePath);
    const normalizedName = normalizeText(fileName);
    const normalizedPath = normalizeText(filePath);

    let bestScore = 0;
    let matchReason: FileMatchReason | undefined;

    if (normalizedName.includes(normalizedQuery.normalized)) {
      bestScore = 120;
      matchReason = "filename";
    } else if (
      matchesTokenGroups(normalizedName, normalizedQuery.tokenGroups)
    ) {
      bestScore = 100;
      matchReason = "filename";
    } else if (normalizedPath.includes(normalizedQuery.normalized)) {
      bestScore = 90;
      matchReason = "path";
    } else if (
      matchesTokenGroups(normalizedPath, normalizedQuery.tokenGroups)
    ) {
      bestScore = 80;
      matchReason = "path";
    }

    const extension = path.extname(filePath).toLowerCase();
    if (
      bestScore < 80 &&
      this.config.fileSearchContentExtensions.includes(extension) &&
      stats.size <= this.config.fileSearchContentMaxFileSizeBytes
    ) {
      const content = await this.readFileContent(filePath, extension);
      if (content) {
        const normalizedContent = normalizeText(content);
        if (normalizedContent.includes(normalizedQuery.normalized)) {
          bestScore = 70;
          matchReason = "content";
        } else if (
          matchesTokenGroups(normalizedContent, normalizedQuery.tokenGroups)
        ) {
          bestScore = 60;
          matchReason = "content";
        }
      }
    }

    if (!matchReason) {
      return undefined;
    }

    return {
      score: bestScore,
      candidate: {
        absolutePath: filePath,
        displayPath: filePath,
        fileName,
        extension,
        sizeBytes: stats.size,
        modifiedAt: stats.mtime.toISOString(),
        matchReason,
      },
    };
  }

  private async readFileContent(
    filePath: string,
    extension: string,
  ): Promise<string | undefined> {
    if (extension === ".pdf") {
      return this.contentReaders.readPdfFile(filePath);
    }

    return this.contentReaders.readTextFile(filePath);
  }

  private async readTextFile(filePath: string): Promise<string | undefined> {
    try {
      const buffer = await fs.readFile(filePath);
      return buffer.toString("utf8").replaceAll(controlCharacterPattern, " ");
    } catch (error) {
      this.logger.debug("Skipping unreadable file content during file search", {
        filePath,
        error: error instanceof Error ? error.message : String(error),
      });
      return undefined;
    }
  }

  private async readPdfFile(filePath: string): Promise<string | undefined> {
    try {
      await suppressPdfWarnings();
      const pdfParse = await loadPdfParse();
      const buffer = await fs.readFile(filePath);
      const result = await pdfParse(buffer);
      return result.text.replaceAll(controlCharacterPattern, " ");
    } catch (error) {
      this.logger.debug("Skipping unreadable PDF content during file search", {
        filePath,
        error: error instanceof Error ? error.message : String(error),
      });
      return undefined;
    }
  }

  private isExcludedPath(candidatePath: string): boolean {
    const normalizedCandidate = normalizeForComparison(
      path.resolve(candidatePath),
    );

    return this.config.fileSearchExcludedRoots.some((excludedRoot) => {
      const normalizedExcludedRoot = normalizeForComparison(
        path.resolve(excludedRoot),
      );
      return (
        normalizedCandidate === normalizedExcludedRoot ||
        normalizedCandidate.startsWith(
          `${normalizedExcludedRoot}${path.sep}`.toLowerCase(),
        )
      );
    });
  }

  private normalizeQuery(query: string): NormalizedQuery {
    const normalized = normalizeText(query);
    const tokens = normalized
      .split(" ")
      .filter(Boolean)
      .filter((token) => !ignoredQueryTokens.has(token));
    const effectiveNormalized = tokens.join(" ");
    const tokenGroups = tokens.map((token) => {
      const variants = new Set<string>([
        token,
        ...(this.config.fileSearchAliases[token] ?? []),
      ]);
      return [...variants]
        .map((variant) => normalizeText(variant))
        .filter(Boolean);
    });

    return {
      raw: query,
      normalized: effectiveNormalized,
      tokenGroups,
    };
  }
}

function matchesTokenGroups(text: string, tokenGroups: string[][]): boolean {
  if (tokenGroups.length === 0) {
    return false;
  }

  return tokenGroups.every((group) =>
    group.some((token) => text.includes(token)),
  );
}

function normalizeText(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/gu, " ")
    .trim()
    .replace(/\s+/gu, " ");
}

function normalizeForComparison(value: string): string {
  return path.resolve(value).toLowerCase();
}

type PdfParseResult = { text: string };
type PdfParseFunction = (buffer: Uint8Array) => Promise<PdfParseResult>;
type PdfJsModule = {
  VERBOSITY_LEVELS?: {
    errors?: number;
  };
  setVerbosityLevel?: (level: number) => void;
};

let cachedPdfParse: PdfParseFunction | undefined;
let pdfWarningsSuppressed = false;

async function loadPdfParse(): Promise<PdfParseFunction> {
  if (cachedPdfParse) {
    return cachedPdfParse;
  }

  const module = (await import("pdf-parse")) as {
    default?: PdfParseFunction;
  };
  const pdfParse = module.default;
  if (!pdfParse) {
    throw new Error("pdf-parse did not expose a default export.");
  }

  cachedPdfParse = pdfParse;
  return pdfParse;
}

async function suppressPdfWarnings(): Promise<void> {
  if (pdfWarningsSuppressed) {
    return;
  }

  pdfWarningsSuppressed = true;

  try {
    const module =
      (await import("pdf-parse/lib/pdf.js/v1.10.100/build/pdf.js")) as PdfJsModule;
    const errorLevel = module.VERBOSITY_LEVELS?.errors ?? 0;
    module.setVerbosityLevel?.(errorLevel);
  } catch {
    return;
  }
}
