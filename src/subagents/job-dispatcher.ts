import { randomUUID } from "node:crypto";

import type { CopilotAgentRole } from "../copilot/agent-role.js";
import type { Logger } from "../logging/logger.js";

export type DelegatedJobKind = "skill-install";
export type DelegatedJobStatus = "queued" | "running" | "completed" | "failed";

export interface DelegatedJobRecord<TResult = unknown> {
  id: string;
  kind: DelegatedJobKind;
  userId: string;
  role: CopilotAgentRole;
  summary: string;
  status: DelegatedJobStatus;
  createdAt: string;
  startedAt?: string;
  finishedAt?: string;
  result?: TResult;
  error?: string;
}

export interface DispatchDelegatedJobInput {
  kind: DelegatedJobKind;
  userId: string;
  role: CopilotAgentRole;
  summary: string;
  timeoutMs?: number;
}

export interface DelegatedJobHandle<TResult> {
  id: string;
  completion: Promise<TResult>;
}

export class DelegatedJobDispatcher {
  private readonly jobs = new Map<string, DelegatedJobRecord>();

  public constructor(
    private readonly logger: Logger,
    private readonly defaultTimeoutMs: number,
  ) {}

  public dispatch<TResult>(
    input: DispatchDelegatedJobInput,
    work: () => Promise<TResult>,
  ): DelegatedJobHandle<TResult> {
    const id = randomUUID();
    const createdAt = new Date().toISOString();

    this.jobs.set(id, {
      id,
      kind: input.kind,
      userId: input.userId,
      role: input.role,
      summary: input.summary,
      status: "queued",
      createdAt,
    });

    const completion = (async () => {
      this.updateJob(id, {
        status: "running",
        startedAt: new Date().toISOString(),
      });

      this.logger.info("Delegated job started", {
        jobId: id,
        kind: input.kind,
        userId: input.userId,
        role: input.role,
      });

      try {
        const result = await withTimeout(
          work(),
          input.timeoutMs ?? this.defaultTimeoutMs,
          `Delegated job ${input.kind} timed out.`,
        );

        this.updateJob(id, {
          status: "completed",
          finishedAt: new Date().toISOString(),
          result,
        });

        this.logger.info("Delegated job completed", {
          jobId: id,
          kind: input.kind,
          userId: input.userId,
          role: input.role,
        });

        return result;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);

        this.updateJob(id, {
          status: "failed",
          finishedAt: new Date().toISOString(),
          error: message,
        });

        this.logger.error("Delegated job failed", {
          jobId: id,
          kind: input.kind,
          userId: input.userId,
          role: input.role,
          error: message,
        });

        throw error;
      }
    })();

    return {
      id,
      completion,
    };
  }

  public getJob(id: string): DelegatedJobRecord | undefined {
    return this.jobs.get(id);
  }

  private updateJob(id: string, update: Partial<DelegatedJobRecord>): void {
    const existing = this.jobs.get(id);
    if (!existing) {
      return;
    }

    this.jobs.set(id, {
      ...existing,
      ...update,
    });
  }
}

async function withTimeout<TResult>(
  promise: Promise<TResult>,
  timeoutMs: number,
  message: string,
): Promise<TResult> {
  if (timeoutMs <= 0) {
    return promise;
  }

  let timer: NodeJS.Timeout | undefined;

  try {
    return await Promise.race([
      promise,
      new Promise<TResult>((_, reject) => {
        timer = setTimeout(() => {
          reject(new Error(`${message} Timeout: ${timeoutMs}ms.`));
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}
