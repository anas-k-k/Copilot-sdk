import { describe, expect, it, vi } from "vitest";

import { OllamaProvider } from "../src/providers/ollama-provider.js";
import type { OllamaToolRegistry } from "../src/providers/ollama-tool-registry.js";
import type { Ollama } from "ollama";

type MockOllamaClient = { chat: ReturnType<typeof vi.fn> };

function createMockClient(
  content = "Hello from Ollama!",
  toolCalls?: Array<{ function: { name: string; arguments: Record<string, unknown> } }>,
): MockOllamaClient {
  const message = toolCalls
    ? { content: "", tool_calls: toolCalls }
    : { content };
  return { chat: vi.fn().mockResolvedValue({ message }) };
}

function asOllamaClient(mock: MockOllamaClient): Ollama {
  return mock as unknown as Ollama;
}

function createMockToolRegistry(
  tools: unknown[] = [],
  callToolResult = '{"ok":true}',
): OllamaToolRegistry {
  return {
    getTools: vi.fn().mockReturnValue(tools),
    callTool: vi.fn().mockResolvedValue(callToolResult),
  } as unknown as OllamaToolRegistry;
}

describe("OllamaProvider", () => {
  it("has name 'ollama'", () => {
    const provider = new OllamaProvider(undefined, asOllamaClient(createMockClient()));
    expect(provider.name).toBe("ollama");
  });

  it("calls chat with the correct model and message", async () => {
    const mockClient = createMockClient();
    const provider = new OllamaProvider({ model: "custom-model" }, asOllamaClient(mockClient));

    await provider.chat("Hi there");

    expect(mockClient.chat).toHaveBeenCalledWith({
      model: "custom-model",
      messages: [{ role: "user", content: "Hi there" }],
    });
  });

  it("returns the message content from chat response", async () => {
    const provider = new OllamaProvider(undefined, asOllamaClient(createMockClient()));
    const result = await provider.chat("Hi there");
    expect(result).toBe("Hello from Ollama!");
  });

  it("uses gemma4:e2b as the default model", async () => {
    const mockClient = createMockClient();
    const provider = new OllamaProvider(undefined, asOllamaClient(mockClient));

    await provider.chat("test");

    expect(mockClient.chat).toHaveBeenCalledWith(
      expect.objectContaining({ model: "gemma4:e2b" }),
    );
  });

  it("prepends a system message when provided", async () => {
    const mockClient = createMockClient();
    const provider = new OllamaProvider(
      { systemMessage: "You are a helpful bot." },
      asOllamaClient(mockClient),
    );

    await provider.chat("Hello");

    expect(mockClient.chat).toHaveBeenCalledWith({
      model: "gemma4:e2b",
      messages: [
        { role: "system", content: "You are a helpful bot." },
        { role: "user", content: "Hello" },
      ],
    });
  });

  it("throws a friendly error when Ollama is unreachable (ECONNREFUSED)", async () => {
    const mockClient: MockOllamaClient = {
      chat: vi.fn().mockRejectedValue(
        Object.assign(new Error("connect ECONNREFUSED 127.0.0.1:11434"), {
          code: "ECONNREFUSED",
        }),
      ),
    };

    const provider = new OllamaProvider(undefined, asOllamaClient(mockClient));
    await expect(provider.chat("test")).rejects.toThrow(
      "Ollama is not running",
    );
  });

  it("re-throws non-connection errors as-is", async () => {
    const mockClient: MockOllamaClient = {
      chat: vi.fn().mockRejectedValue(new Error("model not found")),
    };

    const provider = new OllamaProvider(undefined, asOllamaClient(mockClient));
    await expect(provider.chat("test")).rejects.toThrow("model not found");
  });

  describe("tool calling", () => {
    it("runs the agentic loop when toolRegistry and userId are provided", async () => {
      const toolCalls = [
        { function: { name: "gmail_connection_status", arguments: {} } },
      ];
      const mockClient: MockOllamaClient = {
        chat: vi
          .fn()
          .mockResolvedValueOnce({ message: { content: "", tool_calls: toolCalls } })
          .mockResolvedValueOnce({ message: { content: "Gmail is connected." } }),
      };
      const toolRegistry = createMockToolRegistry(
        [{ type: "function", function: { name: "gmail_connection_status" } }],
        '{"status":"connected"}',
      );

      const provider = new OllamaProvider(undefined, asOllamaClient(mockClient), toolRegistry);
      const result = await provider.chat("Check Gmail", "user-123");

      expect(result).toBe("Gmail is connected.");
      expect(toolRegistry.callTool).toHaveBeenCalledWith(
        "user-123",
        "gmail_connection_status",
        {},
      );
      expect(mockClient.chat).toHaveBeenCalledTimes(2);
    });

    it("returns the final text response after tool calls are resolved", async () => {
      const mockClient: MockOllamaClient = {
        chat: vi
          .fn()
          .mockResolvedValueOnce({
            message: {
              content: "",
              tool_calls: [
                { function: { name: "search_local_files", arguments: { query: "resume" } } },
              ],
            },
          })
          .mockResolvedValueOnce({
            message: { content: "Found 2 matching files." },
          }),
      };
      const toolRegistry = createMockToolRegistry(
        [],
        '{"files":["resume.pdf"]}',
      );

      const provider = new OllamaProvider(undefined, asOllamaClient(mockClient), toolRegistry);
      const result = await provider.chat("Find my resume", "user-42");

      expect(result).toBe("Found 2 matching files.");
    });

    it("passes tools to the Ollama client during the agentic loop", async () => {
      const tools = [{ type: "function", function: { name: "homemate_list_switches" } }];
      const mockClient: MockOllamaClient = {
        chat: vi.fn().mockResolvedValue({ message: { content: "Done." } }),
      };
      const toolRegistry = createMockToolRegistry(tools);

      const provider = new OllamaProvider(undefined, asOllamaClient(mockClient), toolRegistry);
      await provider.chat("List switches", "user-1");

      expect(mockClient.chat).toHaveBeenCalledWith(
        expect.objectContaining({ tools }),
      );
    });

    it("falls back to simple chat when no userId is provided even with a toolRegistry", async () => {
      const mockClient = createMockClient("Simple response.");
      const toolRegistry = createMockToolRegistry();

      const provider = new OllamaProvider(undefined, asOllamaClient(mockClient), toolRegistry);
      const result = await provider.chat("Hello");

      expect(result).toBe("Simple response.");
      expect(toolRegistry.getTools).not.toHaveBeenCalled();
    });

    it("stops after MAX_TOOL_ITERATIONS to prevent infinite loops", async () => {
      const infiniteToolCall = {
        message: {
          content: "",
          tool_calls: [
            { function: { name: "some_tool", arguments: {} } },
          ],
        },
      };
      const mockClient: MockOllamaClient = {
        chat: vi.fn().mockResolvedValue(infiniteToolCall),
      };
      const toolRegistry = createMockToolRegistry([], '{"ok":true}');

      const provider = new OllamaProvider(undefined, asOllamaClient(mockClient), toolRegistry);
      const result = await provider.chat("Loop forever", "user-1");

      expect(mockClient.chat).toHaveBeenCalledTimes(10);
      expect(result).toBe(
        "I was unable to complete that request within the allowed number of steps.",
      );
    });
  });
});
