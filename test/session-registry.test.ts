import { describe, expect, it } from "vitest";

import { SessionRegistry } from "../src/state/session-registry.js";

describe("SessionRegistry", () => {
  it("stores values by user key", () => {
    const registry = new SessionRegistry<string>();
    registry.set("123", "session-a");
    registry.set("456", "session-b");

    expect(registry.get("123")).toBe("session-a");
    expect(registry.get("456")).toBe("session-b");
    expect(registry.keys()).toEqual(["123", "456"]);
  });

  it("deletes values cleanly", () => {
    const registry = new SessionRegistry<string>();
    registry.set("123", "session-a");

    expect(registry.delete("123")).toBe(true);
    expect(registry.get("123")).toBeUndefined();
  });
});
