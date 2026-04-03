import type { Message } from "ollama";
import { DEFAULT_MODEL } from "../providers/models.js";

export interface ChatSession {
  selectedModelId: string;
  ollamaHistory: Message[];
}

export function createSession(): ChatSession {
  return {
    selectedModelId: DEFAULT_MODEL.id,
    ollamaHistory: [],
  };
}

export function resetSession(session: ChatSession): void {
  session.selectedModelId = DEFAULT_MODEL.id;
  session.ollamaHistory = [];
}
