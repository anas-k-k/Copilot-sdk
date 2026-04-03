export interface ModelDefinition {
  id: string;
  label: string;
  backend: "ollama" | "copilot";
  isDefault: boolean;
}

export const MODELS: ModelDefinition[] = [
  {
    id: "gemma4:e2b",
    label: "Gemma 4 (local)",
    backend: "ollama",
    isDefault: true,
  },
  {
    id: "gpt5",
    label: "GPT-5 (Copilot)",
    backend: "copilot",
    isDefault: false,
  },
];

export const DEFAULT_MODEL = MODELS.find((m) => m.isDefault)!;

export function findModel(id: string): ModelDefinition | undefined {
  return MODELS.find((m) => m.id === id);
}
