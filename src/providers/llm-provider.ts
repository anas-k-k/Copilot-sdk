export interface LLMProvider {
  readonly name: string;
  chat(text: string, userId?: string): Promise<string | { response: string; updatedHistory: unknown[] }>;
}
