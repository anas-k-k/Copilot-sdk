import type { AppConfig } from "../config/env.js";
import type { Logger } from "../logging/logger.js";
import { HomeMateClient } from "./homemate-client.js";
import type {
  HomeMateBulkSetSwitchStateResult,
  HomeMateConnectionStatus,
  HomeMateSetSwitchStateResult,
  HomeMateSwitchDetail,
  HomeMateSwitchListResult,
  HomeMateSwitchState,
  HomeMateSwitchSummary,
} from "./types.js";

export class HomeMateService {
  private readonly client: HomeMateClient;

  public constructor(
    private readonly config: AppConfig,
    private readonly logger: Logger,
    client?: HomeMateClient,
  ) {
    this.client = client ?? new HomeMateClient(config, logger);
  }

  public isConfigured(): boolean {
    return Boolean(this.config.homeMateApiBaseUrl);
  }

  public async getConnectionStatus(): Promise<HomeMateConnectionStatus> {
    const baseUrl = this.config.homeMateApiBaseUrl;
    if (!baseUrl) {
      return {
        configured: false,
        error:
          "Set HOMEMATE_API_BASE_URL and the relevant endpoint settings before using HomeMate tools.",
      };
    }

    try {
      const result = await this.client.request(
        "GET",
        this.config.homeMateListSwitchesPath,
      );

      return {
        configured: true,
        authenticated: true,
        baseUrl,
        listPath: this.config.homeMateListSwitchesPath,
        rawOutput: result.text,
        raw: result.json,
      };
    } catch (error) {
      return {
        configured: true,
        authenticated: false,
        baseUrl,
        listPath: this.config.homeMateListSwitchesPath,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  public async listSwitches(): Promise<HomeMateSwitchListResult> {
    this.assertConfigured();
    const result = await this.client.request(
      "GET",
      this.config.homeMateListSwitchesPath,
    );
    const switches = extractCollection(result.json)
      .map((entry, index) => normalizeSwitch(entry, `switch-${index + 1}`))
      .filter((entry): entry is HomeMateSwitchSummary => entry !== undefined)
      .filter((entry) => this.isAllowedSwitch(entry.id));

    return {
      switches,
      rawOutput: result.text,
      ...(result.json !== undefined ? { raw: result.json } : {}),
    };
  }

  public async getSwitch(identifier: string): Promise<HomeMateSwitchDetail> {
    this.assertConfigured();
    const resolved = await this.resolveSwitch(identifier);
    const result = await this.client.request(
      "GET",
      expandTemplate(this.config.homeMateGetSwitchPath, {
        deviceId: encodeURIComponent(resolved.id),
        state: resolved.state,
      }),
    );
    const normalized = normalizeSwitch(result.json, resolved.id);
    const attributes = isRecord(result.json)
      ? (result.json as Record<string, unknown>)
      : undefined;

    return {
      ...(normalized ?? resolved),
      ...(attributes ? { attributes } : {}),
    };
  }

  public async setSwitchState(
    identifier: string,
    requestedState: Exclude<HomeMateSwitchState, "unknown">,
  ): Promise<HomeMateSetSwitchStateResult> {
    this.assertConfigured();
    const resolved = await this.resolveSwitch(identifier);
    return this.setSwitchStateById(resolved.id, requestedState, resolved.name);
  }

  public async setSwitchesStateByIds(
    switchIds: string[],
    requestedState: Exclude<HomeMateSwitchState, "unknown">,
  ): Promise<HomeMateBulkSetSwitchStateResult> {
    this.assertConfigured();
    const uniqueIds = Array.from(new Set(switchIds.filter(Boolean)));
    if (uniqueIds.length === 0) {
      return {
        requestedState,
        targetedSwitchCount: 0,
        succeeded: [],
        failed: [],
        rawOutput: "",
      };
    }

    if (this.config.homeMateBulkSetSwitchStatePath) {
      const response = await this.client.request(
        this.config.homeMateBulkSetSwitchStateMethod,
        this.config.homeMateBulkSetSwitchStatePath,
        {
          body: expandTemplate(
            this.config.homeMateBulkSetSwitchStateBodyTemplate,
            {
              state: requestedState,
              stateBoolean: String(requestedState === "on"),
              stateNumber: requestedState === "on" ? "1" : "0",
              deviceIdsJson: JSON.stringify(uniqueIds),
              deviceIdsCsv: uniqueIds.join(","),
            },
          ),
          headers: {
            "content-type": "application/json",
          },
        },
      );
      const refreshed = await this.listSwitches();
      const succeeded = refreshed.switches.filter((entry) =>
        uniqueIds.includes(entry.id),
      );

      return {
        requestedState,
        targetedSwitchCount: uniqueIds.length,
        succeeded,
        failed: uniqueIds
          .filter((id) => !succeeded.some((entry) => entry.id === id))
          .map((id) => ({
            id,
            error:
              "Bulk request completed but the refreshed switch list did not confirm the device state.",
          })),
        rawOutput: response.text,
        ...(response.json !== undefined ? { raw: response.json } : {}),
      };
    }

    const results = await Promise.all(
      uniqueIds.map(async (switchId) => {
        try {
          const result = await this.setSwitchStateById(
            switchId,
            requestedState,
          );
          return {
            ok: true as const,
            switch: result.switch,
          };
        } catch (error) {
          return {
            ok: false as const,
            id: switchId,
            error: error instanceof Error ? error.message : String(error),
          };
        }
      }),
    );

    return {
      requestedState,
      targetedSwitchCount: uniqueIds.length,
      succeeded: results.flatMap((entry) => (entry.ok ? [entry.switch] : [])),
      failed: results.flatMap((entry) =>
        entry.ok ? [] : [{ id: entry.id, error: entry.error }],
      ),
      rawOutput: JSON.stringify(results),
    };
  }

  public async stageAllKnownSwitches(
    requestedState: Exclude<HomeMateSwitchState, "unknown">,
  ): Promise<{
    requestedState: Exclude<HomeMateSwitchState, "unknown">;
    switches: HomeMateSwitchSummary[];
  }> {
    const result = await this.listSwitches();
    return {
      requestedState,
      switches: result.switches,
    };
  }

  private async resolveSwitch(
    identifier: string,
  ): Promise<HomeMateSwitchSummary> {
    const normalizedIdentifier = identifier.trim().toLowerCase();
    if (!normalizedIdentifier) {
      throw new Error("A switch identifier is required.");
    }

    const list = await this.listSwitches();
    const exactMatches = list.switches.filter((entry) =>
      [entry.id, entry.name].some(
        (candidate) => candidate.trim().toLowerCase() === normalizedIdentifier,
      ),
    );
    if (exactMatches.length === 1) {
      return exactMatches[0]!;
    }

    if (exactMatches.length > 1) {
      throw new Error(
        `More than one switch matches "${identifier}". Use the exact device id instead.`,
      );
    }

    const partialMatches = list.switches.filter((entry) =>
      [entry.id, entry.name].some((candidate) =>
        candidate.trim().toLowerCase().includes(normalizedIdentifier),
      ),
    );
    if (partialMatches.length === 1) {
      return partialMatches[0]!;
    }

    if (partialMatches.length > 1) {
      throw new Error(
        `Multiple switches match "${identifier}": ${partialMatches
          .map((entry) => `${entry.name} (${entry.id})`)
          .join(", ")}.`,
      );
    }

    throw new Error(`No switch matched "${identifier}".`);
  }

  private async tryGetSwitchDetail(
    switchId: string,
  ): Promise<HomeMateSwitchSummary | undefined> {
    try {
      const detail = await this.getSwitch(switchId);
      return detail;
    } catch (error) {
      this.logger.warn("Failed to refresh HomeMate switch state after update", {
        switchId,
        error: error instanceof Error ? error.message : String(error),
      });
      return undefined;
    }
  }

  private async setSwitchStateById(
    switchId: string,
    requestedState: Exclude<HomeMateSwitchState, "unknown">,
    knownName?: string,
  ): Promise<HomeMateSetSwitchStateResult> {
    const body = expandTemplate(
      this.config.homeMateSetSwitchStateBodyTemplate,
      {
        deviceId: switchId,
        deviceName: knownName ?? switchId,
        state: requestedState,
        stateBoolean: String(requestedState === "on"),
        stateNumber: requestedState === "on" ? "1" : "0",
      },
    );

    const response = await this.client.request(
      this.config.homeMateSetSwitchStateMethod,
      expandTemplate(this.config.homeMateSetSwitchStatePath, {
        deviceId: encodeURIComponent(switchId),
        deviceName: knownName ?? switchId,
        state: requestedState,
      }),
      {
        body,
        headers: {
          "content-type": "application/json",
        },
      },
    );

    const detail = await this.tryGetSwitchDetail(switchId);
    const updatedSwitch = detail ?? {
      id: switchId,
      name: knownName ?? switchId,
      state: requestedState,
    };

    return {
      success: true,
      switch: updatedSwitch,
      requestedState,
      rawOutput: response.text,
      ...(response.json !== undefined ? { raw: response.json } : {}),
    };
  }

  private assertConfigured(): void {
    if (!this.isConfigured()) {
      throw new Error(
        "HomeMate is not configured. Set HOMEMATE_API_BASE_URL and related endpoint settings first.",
      );
    }
  }

  private isAllowedSwitch(switchId: string): boolean {
    return (
      this.config.homeMateAllowedSwitchIds.length === 0 ||
      this.config.homeMateAllowedSwitchIds.includes(switchId)
    );
  }
}

function extractCollection(value: unknown): unknown[] {
  if (Array.isArray(value)) {
    return value;
  }

  if (!isRecord(value)) {
    return [];
  }

  for (const key of ["switches", "devices", "items", "result", "data"]) {
    const candidate = value[key];
    if (Array.isArray(candidate)) {
      return candidate;
    }
  }

  return [];
}

function normalizeSwitch(
  value: unknown,
  fallbackId: string,
): HomeMateSwitchSummary | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const id =
    getString(value, ["id", "deviceId", "switchId", "uuid", "uid"]) ||
    fallbackId;
  const name =
    getString(value, ["name", "deviceName", "switchName", "label", "title"]) ||
    id;
  const type = getString(value, ["type", "category", "deviceType", "kind"]);
  const room = getString(value, ["room", "roomName", "location", "group"]);
  const online = getBoolean(value, [
    "online",
    "isOnline",
    "available",
    "reachable",
    "connected",
  ]);
  const state = inferSwitchState(value);

  if (!looksLikeSwitch(value, type, state)) {
    return undefined;
  }

  return {
    id,
    name,
    state,
    ...(online !== undefined ? { online } : {}),
    ...(type ? { type } : {}),
    ...(room ? { room } : {}),
    raw: value,
  };
}

function looksLikeSwitch(
  value: Record<string, unknown>,
  type: string | undefined,
  state: HomeMateSwitchState,
): boolean {
  const haystack = [
    type,
    getString(value, ["model", "description", "name", "label"]),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  return (
    state !== "unknown" ||
    /switch|plug|outlet|socket/.test(haystack) ||
    Boolean(getBoolean(value, ["on", "isOn"]))
  );
}

function inferSwitchState(value: Record<string, unknown>): HomeMateSwitchState {
  for (const key of [
    "state",
    "power",
    "switchState",
    "powerState",
    "status",
    "value",
  ]) {
    const candidate = value[key];
    const parsed = parseStateValue(candidate);
    if (parsed !== "unknown") {
      return parsed;
    }
  }

  for (const key of ["attributes", "payload", "device", "properties"]) {
    const candidate = value[key];
    if (isRecord(candidate)) {
      const parsed = inferSwitchState(candidate);
      if (parsed !== "unknown") {
        return parsed;
      }
    }
  }

  return "unknown";
}

function parseStateValue(value: unknown): HomeMateSwitchState {
  if (typeof value === "boolean") {
    return value ? "on" : "off";
  }

  if (typeof value === "number") {
    return value > 0 ? "on" : "off";
  }

  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["on", "true", "1", "enabled", "open"].includes(normalized)) {
      return "on";
    }

    if (["off", "false", "0", "disabled", "closed"].includes(normalized)) {
      return "off";
    }
  }

  return "unknown";
}

function getString(
  value: Record<string, unknown>,
  keys: string[],
): string | undefined {
  for (const key of keys) {
    const candidate = value[key];
    if (typeof candidate === "string" && candidate.trim()) {
      return candidate.trim();
    }
  }

  return undefined;
}

function getBoolean(
  value: Record<string, unknown>,
  keys: string[],
): boolean | undefined {
  for (const key of keys) {
    const candidate = value[key];
    if (typeof candidate === "boolean") {
      return candidate;
    }
  }

  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function expandTemplate(
  template: string,
  variables: Record<string, string>,
): string {
  return template.replace(/\{([A-Za-z0-9_]+)\}/g, (_match, key: string) => {
    return variables[key] ?? "";
  });
}
