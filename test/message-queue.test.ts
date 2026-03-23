import { describe, expect, it, vi } from "vitest";

import {
  MessageQueue,
  MessageQueueTimeoutError,
} from "../src/state/message-queue.js";

describe("MessageQueue", () => {
  it("releases the queue after a timeout", async () => {
    vi.useFakeTimers();

    const queue = new MessageQueue(50);
    const work = vi
      .fn<() => Promise<string>>()
      .mockImplementationOnce(
        () =>
          new Promise<string>((resolve) => {
            setTimeout(() => resolve("slow"), 1_000);
          }),
      )
      .mockResolvedValueOnce("fast");

    const firstPromise = queue.enqueue("user-1", work);
    await vi.advanceTimersByTimeAsync(60);

    await expect(firstPromise).rejects.toBeInstanceOf(MessageQueueTimeoutError);

    const secondPromise = queue.enqueue("user-1", work);
    await expect(secondPromise).resolves.toBe("fast");

    vi.useRealTimers();
  });
});
