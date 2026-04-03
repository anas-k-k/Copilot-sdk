export interface RoutedMessage {
  useOllama: boolean;
  text: string;
}

const GPT5_PREFIX_PATTERN = /^use\s+gpt5\s*/iu;

export function routeMessage(text: string): RoutedMessage {
  const trimmed = text.trim();
  const match = GPT5_PREFIX_PATTERN.exec(trimmed);
  if (match) {
    return { useOllama: false, text: trimmed.slice(match[0].length).trim() };
  }
  return { useOllama: true, text: trimmed };
}
