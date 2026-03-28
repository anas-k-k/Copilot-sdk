export interface PendingOutboundFile {
  filePath: string;
  caption?: string;
  delivery?: "document" | "photo";
}

export class OutboundFileRegistry {
  private readonly pendingByUserId = new Map<string, PendingOutboundFile[]>();

  public stage(userId: string, pendingFile: PendingOutboundFile): void {
    const existing = this.pendingByUserId.get(userId) ?? [];
    existing.push(pendingFile);
    this.pendingByUserId.set(userId, existing);
  }

  public drain(userId: string): PendingOutboundFile[] {
    const pending = this.pendingByUserId.get(userId) ?? [];
    this.pendingByUserId.delete(userId);
    return pending;
  }
}
