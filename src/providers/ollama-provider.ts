import type { Message, Tool } from "ollama";
import { Ollama } from "ollama";

import type { LLMProvider } from "./llm-provider.js";
import type { OllamaToolRegistry } from "./ollama-tool-registry.js";

export interface OllamaProviderOptions {
  baseUrl?: string;
  model?: string;
  systemMessage?: string;
}

const MAX_TOOL_ITERATIONS = 10;

export class OllamaProvider implements LLMProvider {
  public readonly name = "ollama";
  private readonly model: string;
  private readonly client: Ollama;
  private readonly systemMessage: string | undefined;
  private readonly toolRegistry: OllamaToolRegistry | undefined;

  public constructor(
    options?: OllamaProviderOptions,
    client?: Ollama,
    toolRegistry?: OllamaToolRegistry,
  ) {
    this.model = options?.model ?? "gemma4:e2b";
    this.systemMessage = options?.systemMessage;
    this.toolRegistry = toolRegistry;
    this.client =
      client ??
      new Ollama({
        host: options?.baseUrl ?? "http://localhost:11434",
      });
  }

  public async chat(
    text: string,
    userId?: string,
    conversationHistory?: Message[],
  ): Promise<{ response: string; updatedHistory: Message[] }> {
    const messages: Message[] = [];

    if (this.systemMessage) {
      messages.push({ role: "system", content: this.systemMessage });
    }

    if (conversationHistory) {
      messages.push(...conversationHistory);
    }

    messages.push({ role: "user", content: text });

    try {
      let response: string;

      if (this.toolRegistry && userId) {
        response = await this.runAgenticLoop(messages, userId);
      } else {
        const result = await this.client.chat({
          model: this.model,
          messages,
        });
        response = result.message.content;
      }

      const historyWithoutSystem = messages.filter(
        (m) => m.role !== "system",
      );
      historyWithoutSystem.push({ role: "assistant", content: response });

      return { response, updatedHistory: historyWithoutSystem };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (
        message.includes("ECONNREFUSED") ||
        message.includes("fetch failed") ||
        message.includes("connect ECONNREFUSED")
      ) {
        throw new Error(
          "⚠️ Ollama is not running. Start it with `ollama serve` and ensure the model is available with `ollama pull gemma4:e2b`.",
        );
      }
      throw error;
    }
  }

  private async runAgenticLoop(
    messages: Message[],
    userId: string,
  ): Promise<string> {
    const tools: Tool[] = this.toolRegistry!.getTools();
    let lastContent = "";

    for (let iteration = 0; iteration < MAX_TOOL_ITERATIONS; iteration++) {
      const response = await this.client.chat({
        model: this.model,
        messages,
        tools,
      });

      const assistantMessage = response.message;
      messages.push(assistantMessage);

      if (assistantMessage.content) {
        lastContent = assistantMessage.content;
      }

      if (
        !assistantMessage.tool_calls ||
        assistantMessage.tool_calls.length === 0
      ) {
        return lastContent;
      }

      for (const toolCall of assistantMessage.tool_calls) {
        const result = await this.toolRegistry!.callTool(
          userId,
          toolCall.function.name,
          toolCall.function.arguments,
        );
        messages.push({
          role: "tool",
          content: result,
          tool_name: toolCall.function.name,
        });
      }
    }

    return (
      lastContent ||
      "I was unable to complete that request within the allowed number of steps."
    );
  }
}
