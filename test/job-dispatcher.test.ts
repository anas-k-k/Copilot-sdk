import { describe, expect, it, vi } from "vitest";

import { Logger } from "../src/logging/logger.js";
import { DelegatedJobDispatcher } from "../src/subagents/job-dispatcher.js";

describe("DelegatedJobDispatcher", () => {
  it("tracks successful delegated jobs", async () => {
    const dispatcher = new DelegatedJobDispatcher(new Logger("error"), 100);
    const job = dispatcher.dispatch(
      {
        kind: "skill-install",
        userId: "user-1",
        role: "skill-installer",
        summary: "Install skill",
      },
      async () => "done",
    );

    await expect(job.completion).resolves.toBe("done");
    expect(dispatcher.getJob(job.id)?.status).toBe("completed");
  });

  it("tracks failed delegated jobs", async () => {
    const logger = new Logger("error");
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const dispatcher = new DelegatedJobDispatcher(logger, 100);
    const job = dispatcher.dispatch(
      {
        kind: "skill-install",
        userId: "user-1",
        role: "skill-installer",
        summary: "Install skill",
      },
      async () => {
        throw new Error("boom");
      },
    );

    await expect(job.completion).rejects.toThrow("boom");
    expect(dispatcher.getJob(job.id)?.status).toBe("failed");

    errorSpy.mockRestore();
  });
});
