export interface FrontmatterParseResult {
  attributes: Record<string, string>;
  body: string;
}

export function parseFrontmatter(markdown: string): FrontmatterParseResult {
  const lines = markdown.split(/\r?\n/);
  if (lines[0]?.trim() !== "---") {
    return { attributes: {}, body: markdown };
  }

  const closingIndex = lines.findIndex((line, index) => index > 0 && line.trim() === "---");
  if (closingIndex === -1) {
    return { attributes: {}, body: markdown };
  }

  const headerLines = lines.slice(1, closingIndex);
  const attributes: Record<string, string> = {};
  for (const line of headerLines) {
    const match = line.match(/^([A-Za-z0-9_.-]+)\s*:\s*(.+)$/);
    if (!match) {
      continue;
    }

    const [, key, rawValue] = match;
    if (!key || !rawValue) {
      continue;
    }

    attributes[key] = rawValue.trim().replace(/^['"]|['"]$/g, "");
  }

  return {
    attributes,
    body: lines.slice(closingIndex + 1).join("\n").trim(),
  };
}
