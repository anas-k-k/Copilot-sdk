import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import type { AppConfig } from "../src/config/env.js";
import { Logger } from "../src/logging/logger.js";
import { SkillService } from "../src/skills/skill-service.js";
import type { ExecText } from "../src/utils/process.js";
import { createTestConfig } from "./test-config.js";

describe("SkillService", () => {
  it("lists installed skills from the user workspace", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "skills-bot-"));
    const service = new SkillService(createConfig(root), new Logger("error"));

    const skillDirectory = path.join(
      root,
      "user-1",
      "project",
      ".agents",
      "skills",
      "review-helper",
    );
    await mkdir(skillDirectory, { recursive: true });
    await writeFile(
      path.join(skillDirectory, "SKILL.md"),
      `---
name: review-helper
description: Helps with review tasks
---

# Review Helper`,
      "utf8",
    );

    const skills = await service.listInstalledSkills("user-1");
    expect(skills).toHaveLength(1);
    expect(skills[0]?.name).toBe("review-helper");
  });

  it("builds a per-user install command and returns discovered skills", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "skills-bot-"));
    let capturedCommand:
      | { command: string; args: string[]; cwd?: string }
      | undefined;

    const execText: ExecText = async (command, args, options) => {
      capturedCommand = options?.cwd
        ? { command, args, cwd: options.cwd }
        : { command, args };

      const skillDirectory = path.join(
        root,
        "user-2",
        "project",
        ".agents",
        "skills",
        "frontend-design",
      );

      await mkdir(skillDirectory, { recursive: true });
      await writeFile(
        path.join(skillDirectory, "SKILL.md"),
        `---
name: frontend-design
description: Helps with frontend design work
---

# Frontend Design`,
        "utf8",
      );

      return { stdout: "installed", stderr: "" };
    };

    const service = new SkillService(
      createConfig(root),
      new Logger("error"),
      execText,
    );
    const result = await service.installSkills("user-2", {
      id: "req-1",
      source: "vercel-labs/agent-skills",
      requestedSkills: ["frontend-design"],
      reason: "Needed for UI work",
      goal: "Improve the interface",
      createdAt: new Date().toISOString(),
    });

    expect(capturedCommand).toEqual({
      command: "npx",
      args: [
        "skills",
        "add",
        "vercel-labs/agent-skills",
        "-a",
        "github-copilot",
        "--copy",
        "-y",
        "--skill",
        "frontend-design",
      ],
      cwd: path.join(root, "user-2", "project"),
    });
    expect(result.installedSkills.map((skill) => skill.name)).toEqual([
      "frontend-design",
    ]);
  });

  it("parses search output into candidates", async () => {
    const execText: ExecText = async () => ({
      stdout: "- vercel-labs/agent-skills\n- owner/testing-skills",
      stderr: "",
    });

    const service = new SkillService(
      createConfig("C:\\temp"),
      new Logger("error"),
      execText,
    );
    const result = await service.searchSkills("testing");

    expect(result.candidates.map((candidate) => candidate.title)).toEqual([
      "vercel-labs/agent-skills",
      "owner/testing-skills",
    ]);
  });
});

function createConfig(appUserStateRoot: string): AppConfig {
  return createTestConfig({
    appUserStateRoot,
  });
}
