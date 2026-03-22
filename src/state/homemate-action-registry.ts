import { randomUUID } from "node:crypto";

export interface PendingHomeMateBulkSwitchAction {
  id: string;
  requestedState: "on" | "off";
  switchIds: string[];
  switchNames: string[];
  createdAt: string;
}

export class HomeMateActionRegistry {
  private readonly pendingBulkActions = new Map<
    string,
    PendingHomeMateBulkSwitchAction
  >();

  public stageBulkSwitchAction(
    userId: string,
    input: {
      requestedState: "on" | "off";
      switchIds: string[];
      switchNames: string[];
    },
  ): PendingHomeMateBulkSwitchAction {
    const pending: PendingHomeMateBulkSwitchAction = {
      id: randomUUID(),
      requestedState: input.requestedState,
      switchIds: input.switchIds,
      switchNames: input.switchNames,
      createdAt: new Date().toISOString(),
    };

    this.pendingBulkActions.set(userId, pending);
    return pending;
  }

  public getPendingBulkSwitchAction(
    userId: string,
  ): PendingHomeMateBulkSwitchAction | undefined {
    return this.pendingBulkActions.get(userId);
  }

  public clearPendingBulkSwitchAction(userId: string): void {
    this.pendingBulkActions.delete(userId);
  }
}
