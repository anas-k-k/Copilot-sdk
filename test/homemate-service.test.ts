import { describe, expect, it, vi } from "vitest";

import { HomeMateClient } from "../src/homemate/homemate-client.js";
import { HomeMateService } from "../src/homemate/homemate-service.js";
import { Logger } from "../src/logging/logger.js";
import { createTestConfig } from "./test-config.js";

describe("HomeMateService", () => {
  it("returns an unconfigured status when no API base URL is set", async () => {
    const service = new HomeMateService(
      createTestConfig(),
      new Logger("error"),
    );

    const status = await service.getConnectionStatus();

    expect(status.configured).toBe(false);
    expect(status.error).toContain("HOMEMATE_API_BASE_URL");
  });

  it("normalizes switch devices from a list response", async () => {
    const client = {
      request: vi.fn().mockResolvedValue({
        status: 200,
        text: JSON.stringify({
          devices: [
            {
              id: "switch-1",
              name: "Kitchen",
              type: "switch",
              online: true,
              state: "on",
            },
            {
              id: "sensor-1",
              name: "Thermometer",
              type: "sensor",
            },
          ],
        }),
        json: {
          devices: [
            {
              id: "switch-1",
              name: "Kitchen",
              type: "switch",
              online: true,
              state: "on",
            },
            {
              id: "sensor-1",
              name: "Thermometer",
              type: "sensor",
            },
          ],
        },
      }),
    } as unknown as HomeMateClient;

    const service = new HomeMateService(
      createTestConfig({ homeMateApiBaseUrl: "https://api.example.test" }),
      new Logger("error"),
      client,
    );

    const result = await service.listSwitches();

    expect(result.switches).toEqual([
      expect.objectContaining({
        id: "switch-1",
        name: "Kitchen",
        state: "on",
        online: true,
      }),
    ]);
  });

  it("updates a switch by exact name and refreshes its state", async () => {
    const client = {
      request: vi
        .fn()
        .mockResolvedValueOnce({
          status: 200,
          text: JSON.stringify({
            devices: [
              { id: "switch-1", name: "Kitchen", type: "switch", state: "off" },
            ],
          }),
          json: {
            devices: [
              { id: "switch-1", name: "Kitchen", type: "switch", state: "off" },
            ],
          },
        })
        .mockResolvedValueOnce({
          status: 200,
          text: JSON.stringify({ ok: true }),
          json: { ok: true },
        })
        .mockResolvedValueOnce({
          status: 200,
          text: JSON.stringify({
            id: "switch-1",
            name: "Kitchen",
            type: "switch",
            state: "on",
            online: true,
          }),
          json: {
            id: "switch-1",
            name: "Kitchen",
            type: "switch",
            state: "on",
            online: true,
          },
        }),
    } as unknown as HomeMateClient;

    const service = new HomeMateService(
      createTestConfig({ homeMateApiBaseUrl: "https://api.example.test" }),
      new Logger("error"),
      client,
    );

    const result = await service.setSwitchState("Kitchen", "on");

    expect(result.success).toBe(true);
    expect(result.switch.state).toBe("on");
    expect((client.request as ReturnType<typeof vi.fn>).mock.calls[1]).toEqual([
      "PATCH",
      "/devices/switch-1",
      {
        body: '{"state":"on"}',
        headers: {
          "content-type": "application/json",
        },
      },
    ]);
  });

  it("falls back to per-switch requests when no bulk endpoint is configured", async () => {
    const client = {
      request: vi.fn(async (_method: string, requestPath: string) => {
        if (requestPath === "/devices/switch-2") {
          throw new Error("device offline");
        }

        if (requestPath === "/devices/switch-1") {
          return {
            status: 200,
            text: JSON.stringify({ ok: true }),
            json: { ok: true },
          };
        }

        return {
          status: 200,
          text: JSON.stringify({
            id: "switch-1",
            name: "switch-1",
            type: "switch",
            state: "off",
          }),
          json: {
            id: "switch-1",
            name: "switch-1",
            type: "switch",
            state: "off",
          },
        };
      }),
    } as unknown as HomeMateClient;

    const service = new HomeMateService(
      createTestConfig({ homeMateApiBaseUrl: "https://api.example.test" }),
      new Logger("error"),
      client,
    );

    const result = await service.setSwitchesStateByIds(
      ["switch-1", "switch-2"],
      "off",
    );

    expect(result.targetedSwitchCount).toBe(2);
    expect(result.succeeded).toHaveLength(1);
    expect(result.failed).toEqual([
      expect.objectContaining({ id: "switch-2", error: "device offline" }),
    ]);
  });
});
