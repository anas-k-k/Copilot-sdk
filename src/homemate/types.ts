export type HomeMateSwitchState = "on" | "off" | "unknown";

export interface HomeMateConnectionStatus {
  configured: boolean;
  authenticated?: boolean;
  baseUrl?: string;
  listPath?: string;
  error?: string;
  rawOutput?: string;
  raw?: unknown;
}

export interface HomeMateSwitchSummary {
  id: string;
  name: string;
  state: HomeMateSwitchState;
  online?: boolean;
  type?: string;
  room?: string;
  raw?: unknown;
}

export interface HomeMateSwitchListResult {
  switches: HomeMateSwitchSummary[];
  rawOutput: string;
  raw?: unknown;
}

export interface HomeMateSwitchDetail extends HomeMateSwitchSummary {
  attributes?: Record<string, unknown>;
}

export interface HomeMateSetSwitchStateResult {
  success: boolean;
  switch: HomeMateSwitchSummary;
  requestedState: Exclude<HomeMateSwitchState, "unknown">;
  rawOutput: string;
  raw?: unknown;
}

export interface HomeMateBulkSetSwitchStateResult {
  requestedState: Exclude<HomeMateSwitchState, "unknown">;
  targetedSwitchCount: number;
  succeeded: HomeMateSwitchSummary[];
  failed: Array<{
    id: string;
    name?: string;
    error: string;
  }>;
  rawOutput: string;
  raw?: unknown;
}
