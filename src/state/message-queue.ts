export class MessageQueueTimeoutError extends Error {
  public constructor(
    public readonly key: string,
    public readonly timeoutMs: number,
  ) {
    super(`Message queue work for ${key} timed out after ${timeoutMs}ms.`);
    this.name = "MessageQueueTimeoutError";
  }
}

export class MessageQueue {
  private readonly chains = new Map<string, Promise<void>>();

  public constructor(private readonly defaultTimeoutMs?: number) {}

  public enqueue<T>(
    key: string,
    work: () => Promise<T>,
    timeoutMs = this.defaultTimeoutMs,
  ): Promise<T> {
    const previous = this.chains.get(key) ?? Promise.resolve();

    let resolveCurrent: (() => void) | undefined;
    const current = new Promise<void>((resolve) => {
      resolveCurrent = resolve;
    });

    const chained = previous.catch(() => undefined).then(() => current);
    this.chains.set(key, chained);

    return previous
      .catch(() => undefined)
      .then(() =>
        timeoutMs === undefined ? work() : withTimeout(key, work, timeoutMs),
      )
      .finally(() => {
        resolveCurrent?.();
        if (this.chains.get(key) === chained) {
          this.chains.delete(key);
        }
      });
  }
}

async function withTimeout<T>(
  key: string,
  work: () => Promise<T>,
  timeoutMs: number,
): Promise<T> {
  let timer: NodeJS.Timeout | undefined;

  try {
    return await Promise.race([
      work(),
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => {
          reject(new MessageQueueTimeoutError(key, timeoutMs));
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}
