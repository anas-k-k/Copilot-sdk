import { promises as fs } from "node:fs";
import path from "node:path";

import type { AppConfig } from "../config/env.js";
import type { Logger } from "../logging/logger.js";
import { parseFrontmatter } from "../utils/frontmatter.js";
import type { ExecText } from "../utils/process.js";
import { execFileText } from "../utils/process.js";
import { stripAnsi } from "../utils/text.js";
import type {
  PendingSkillInstallRequest,
  SkillInstallResult,
  SkillMetadata,
  SkillSearchCandidate,
  SkillSearchResult,
} from "./types.js";

export class SkillService {
  public constructor(
    private readonly config: AppConfig,
    private readonly logger: Logger,
    private readonly execText: ExecText = execFileText,
  ) {}

  public getUserProjectRoot(userId: string): string {
    return path.join(this.config.appUserStateRoot, userId, "project");
  }

  public getInstalledSkillDirectory(userId: string): string {
    return path.join(this.getUserProjectRoot(userId), ".agents", "skills");
  }

  public getSearchWorkspaceRoot(): string {
    return path.join(this.config.appUserStateRoot, "_registry-search");
  }

  public async ensureUserWorkspace(userId: string): Promise<void> {
    await fs.mkdir(this.getUserProjectRoot(userId), { recursive: true });
    await fs.mkdir(this.getInstalledSkillDirectory(userId), {
      recursive: true,
    });
  }

  public async searchSkills(query: string): Promise<SkillSearchResult> {
    const trimmedQuery = query.trim();
    if (!trimmedQuery) {
      throw new Error("Skill search query cannot be empty.");
    }

    await fs.mkdir(this.getSearchWorkspaceRoot(), { recursive: true });

    const { stdout, stderr } = await this.execText(
      this.config.skillsCommand,
      ["skills", "find", trimmedQuery],
      {
        cwd: this.getSearchWorkspaceRoot(),
        env: {
          ...process.env,
          DISABLE_TELEMETRY: "1",
          DO_NOT_TRACK: "1",
        },
      },
    );

    const rawOutput = [stdout, stderr].filter(Boolean).join("\n").trim();
    const candidates = parseSearchCandidates(rawOutput);
    this.logger.info("Skill search completed", {
      query: trimmedQuery,
      candidates: candidates.length,
    });

    return {
      query: trimmedQuery,
      candidates,
      rawOutput,
    };
  }

  public async listInstalledSkills(userId: string): Promise<SkillMetadata[]> {
    const skillRoot = this.getInstalledSkillDirectory(userId);
    const skills = await readSkillsFromDirectory(skillRoot);
    return skills.sort((left, right) => left.name.localeCompare(right.name));
  }

  public async installSkills(
    userId: string,
    request: PendingSkillInstallRequest,
  ): Promise<SkillInstallResult> {
    await this.ensureUserWorkspace(userId);

    const installDirectory = this.getInstalledSkillDirectory(userId);
    const previousSkills = await this.listInstalledSkills(userId);
    const args = [
      "skills",
      "add",
      request.source,
      "-a",
      this.config.skillsAgent,
      "--copy",
      "-y",
    ];

    for (const skill of request.requestedSkills) {
      args.push("--skill", skill);
    }

    this.logger.info("Installing skills", {
      userId,
      source: request.source,
      requestedSkills: request.requestedSkills,
    });

    const { stdout, stderr } = await this.execText(
      this.config.skillsCommand,
      args,
      {
        cwd: this.getUserProjectRoot(userId),
        env: {
          ...process.env,
          DISABLE_TELEMETRY: "1",
          DO_NOT_TRACK: "1",
        },
        timeoutMs: this.config.skillInstallTimeoutMs,
      },
    );

    const allSkills = await this.listInstalledSkills(userId);
    const previousNames = new Set(previousSkills.map((skill) => skill.name));
    const requestedNames = new Set(request.requestedSkills);

    const installedSkills =
      requestedNames.size > 0
        ? allSkills.filter((skill) => requestedNames.has(skill.name))
        : allSkills.filter((skill) => !previousNames.has(skill.name));

    return {
      userId,
      source: request.source,
      requestedSkills: request.requestedSkills,
      installedSkills,
      stdout,
      stderr,
      installDirectory,
    };
  }
}

async function readSkillsFromDirectory(
  directoryPath: string,
): Promise<SkillMetadata[]> {
  try {
    const entries = await fs.readdir(directoryPath, { withFileTypes: true });
    const skills: SkillMetadata[] = [];

    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue;
      }

      const skillDirectory = path.join(directoryPath, entry.name);
      const skillFilePath = path.join(skillDirectory, "SKILL.md");

      try {
        const markdown = await fs.readFile(skillFilePath, "utf8");
        const parsed = parseFrontmatter(markdown);
        skills.push({
          name: parsed.attributes.name || entry.name,
          description:
            parsed.attributes.description || "No description provided.",
          directoryPath: skillDirectory,
          skillFilePath,
        });
      } catch {
        continue;
      }
    }

    return skills;
  } catch (error) {
    const nodeError = error as NodeJS.ErrnoException;
    if (nodeError.code === "ENOENT") {
      return [];
    }

    throw error;
  }
}

function parseSearchCandidates(rawOutput: string): SkillSearchCandidate[] {
  const lines = stripAnsi(rawOutput)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const candidates: SkillSearchCandidate[] = [];

  for (const line of lines) {
    if (
      line.startsWith("?") ||
      line.startsWith(">") ||
      /^search/i.test(line) ||
      /^use .*arrow/i.test(line) ||
      /^press /i.test(line)
    ) {
      continue;
    }

    const cleaned = line.replace(/^(?:[-*]|\d+\.)\s+/, "").trim();
    if (!cleaned) {
      continue;
    }

    candidates.push({ title: cleaned });
    if (candidates.length >= 10) {
      break;
    }
  }

  return candidates;
}
