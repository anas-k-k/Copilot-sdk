export class MessageQueue {
  private readonly chains = new Map<string, Promise<void>>();

  public enqueue<T>(key: string, work: () => Promise<T>): Promise<T> {
    const previous = this.chains.get(key) ?? Promise.resolve();

    let resolveCurrent: (() => void) | undefined;
    const current = new Promise<void>((resolve) => {
      resolveCurrent = resolve;
    });

    const chained = previous.catch(() => undefined).then(() => current);
    this.chains.set(key, chained);

    return previous
      .catch(() => undefined)
      .then(work)
      .finally(() => {
        resolveCurrent?.();
        if (this.chains.get(key) === chained) {
          this.chains.delete(key);
        }
      });
  }
}
