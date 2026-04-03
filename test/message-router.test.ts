import { describe, expect, it } from "vitest";

import { routeMessage } from "../src/providers/message-router.js";

describe("routeMessage", () => {
  it("routes plain messages to Ollama", () => {
    const result = routeMessage("hello world");
    expect(result.useOllama).toBe(true);
    expect(result.text).toBe("hello world");
  });

  it("routes 'use gpt5 <question>' to GPT-5 and strips the prefix", () => {
    const result = routeMessage("use gpt5 what is TypeScript?");
    expect(result.useOllama).toBe(false);
    expect(result.text).toBe("what is TypeScript?");
  });

  it("is case-insensitive for the prefix", () => {
    expect(routeMessage("USE GPT5 hello").useOllama).toBe(false);
    expect(routeMessage("Use Gpt5 hello").useOllama).toBe(false);
  });

  it("strips the prefix and returns the cleaned text", () => {
    const result = routeMessage("use gpt5   extra spaces here");
    expect(result.useOllama).toBe(false);
    expect(result.text).toBe("extra spaces here");
  });

  it("trims surrounding whitespace from plain messages", () => {
    const result = routeMessage("  hello world  ");
    expect(result.useOllama).toBe(true);
    expect(result.text).toBe("hello world");
  });

  it("routes 'use gpt5' with no following text to GPT-5 with empty text", () => {
    const result = routeMessage("use gpt5");
    expect(result.useOllama).toBe(false);
    expect(result.text).toBe("");
  });

  it("does not match 'use gpt5' in the middle of a message", () => {
    const result = routeMessage("please use gpt5 for this");
    expect(result.useOllama).toBe(true);
    expect(result.text).toBe("please use gpt5 for this");
  });

  it("handles whitespace variants between 'use' and 'gpt5'", () => {
    const result = routeMessage("use  gpt5 multi-space");
    expect(result.useOllama).toBe(false);
    expect(result.text).toBe("multi-space");
  });
});
