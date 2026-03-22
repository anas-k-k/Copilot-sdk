export class SessionRegistry<T> {
  private readonly items = new Map<string, T>();

  public get(key: string): T | undefined {
    return this.items.get(key);
  }

  public set(key: string, value: T): void {
    this.items.set(key, value);
  }

  public delete(key: string): boolean {
    return this.items.delete(key);
  }

  public keys(): string[] {
    return [...this.items.keys()];
  }

  public clear(): void {
    this.items.clear();
  }
}
