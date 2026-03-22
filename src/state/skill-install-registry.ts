import { randomUUID } from "node:crypto";

import type { PendingSkillInstallRequest, SkillMetadata } from "../skills/types.js";

export interface StageInstallRequestInput {
  source: string;
  requestedSkills: string[];
  reason: string;
  goal: string;
}

export class SkillInstallRegistry {
  private readonly pendingByUser = new Map<string, PendingSkillInstallRequest>();
  private readonly installedByUser = new Map<string, SkillMetadata[]>();

  public stage(userId: string, input: StageInstallRequestInput): PendingSkillInstallRequest {
    const request: PendingSkillInstallRequest = {
      id: randomUUID(),
      source: input.source,
      requestedSkills: input.requestedSkills,
      reason: input.reason,
      goal: input.goal,
      createdAt: new Date().toISOString(),
    };

    this.pendingByUser.set(userId, request);
    return request;
  }

  public getPending(userId: string): PendingSkillInstallRequest | undefined {
    return this.pendingByUser.get(userId);
  }

  public clearPending(userId: string): void {
    this.pendingByUser.delete(userId);
  }

  public rememberInstalled(userId: string, skills: SkillMetadata[]): void {
    this.installedByUser.set(userId, skills);
  }

  public getInstalled(userId: string): SkillMetadata[] {
    return this.installedByUser.get(userId) ?? [];
  }
}
