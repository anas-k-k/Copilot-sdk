const ansiPattern =
  // eslint-disable-next-line no-control-regex
  /\u001b(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g;

const markdownTableSeparatorPattern =
  /^\|?(?:\s*:?-{3,}:?\s*\|)+\s*:?-{3,}:?\s*\|?$/u;

const codeFencePattern = /^\s*```/u;
const preTagPattern = /(<pre>[\s\S]*?<\/pre>)/gu;
const preBlockTokenPrefix = "@@TG_PRE_BLOCK_";

export interface TelegramFormattedMessage {
  text: string;
  parseMode: "HTML";
}

export function stripAnsi(value: string): string {
  return value.replaceAll(ansiPattern, "");
}

export function formatTelegramMessage(text: string): TelegramFormattedMessage {
  const normalized = text.replaceAll("\r\n", "\n").trim();
  if (!normalized) {
    return { text: normalized, parseMode: "HTML" };
  }

  const { text: preformatted, blocks } = rewritePreformattedBlocks(normalized);
  const linkFormatted = rewriteMarkdownLinks(preformatted);
  const emphasisFormatted = stripMarkdownEmphasis(linkFormatted);
  const escaped = escapeHtml(
    emphasisFormatted
      .replace(/^[\t ]*(?:-{3,}|_{3,}|\*{3,})[\t ]*$/gmu, "")
      .replace(/\n{3,}/g, "\n\n")
      .trim(),
  );

  return {
    text: restorePreformattedBlocks(escaped, blocks),
    parseMode: "HTML",
  };
}

export function splitMessage(text: string, maxLength = 4000): string[] {
  if (text.length <= maxLength) {
    return [text];
  }

  const segments = splitHtmlSegments(text);
  const parts: string[] = [];
  let current = "";

  for (const segment of segments) {
    const splitSegments =
      segment.length > maxLength
        ? segment.startsWith("<pre>")
          ? splitPreformattedSegment(segment, maxLength)
          : splitPlainTextSegment(segment, maxLength)
        : [segment];

    for (const chunk of splitSegments) {
      if (!chunk.trim()) {
        continue;
      }

      if (!current) {
        current = chunk;
        continue;
      }

      if ((current + chunk).length > maxLength) {
        parts.push(current.trim());
        current = chunk;
        continue;
      }

      current += chunk;
    }
  }

  if (current.trim()) {
    parts.push(current.trim());
  }

  return parts;
}

export function isAffirmative(input: string): boolean {
  return /^(?:y|yes|confirm|approved?|install|go ahead|ok|okay|do it)\b/i.test(
    input.trim(),
  );
}

export function isNegative(input: string): boolean {
  return /^(?:n|no|cancel|stop|don'?t|do not)\b/i.test(input.trim());
}

export function isStopCommand(input: string): boolean {
  return /^(?:stop|end|finish|done|quit|halt|that'?s enough|enough)\b/i.test(
    input.trim(),
  );
}

function rewritePreformattedBlocks(text: string): {
  text: string;
  blocks: string[];
} {
  const lines = text.split("\n");
  const output: string[] = [];
  const blocks: string[] = [];

  for (let index = 0; index < lines.length; ) {
    if (codeFencePattern.test(lines[index] ?? "")) {
      index += 1;
      const bodyLines: string[] = [];

      while (
        index < lines.length &&
        !codeFencePattern.test(lines[index] ?? "")
      ) {
        bodyLines.push(lines[index] ?? "");
        index += 1;
      }

      if (index < lines.length && codeFencePattern.test(lines[index] ?? "")) {
        index += 1;
      }

      if (bodyLines.length > 0) {
        output.push(registerPreformattedBlock(bodyLines.join("\n"), blocks));
      }
      continue;
    }

    const markdownHeader = getPipeRowCells(lines[index] ?? "");
    if (
      markdownHeader &&
      index + 1 < lines.length &&
      markdownTableSeparatorPattern.test((lines[index + 1] ?? "").trim())
    ) {
      const tableRows: string[][] = [markdownHeader];
      index += 2;

      while (index < lines.length) {
        const row = getPipeRowCells(lines[index] ?? "");
        if (!row || row.length !== markdownHeader.length) {
          break;
        }

        tableRows.push(row);
        index += 1;
      }

      output.push(
        registerPreformattedBlock(formatAlignedTable(tableRows, true), blocks),
      );
      continue;
    }

    const row = getPipeRowCells(lines[index] ?? "");
    const nextRow = getPipeRowCells(lines[index + 1] ?? "");
    if (row && nextRow && row.length === nextRow.length) {
      const tableRows: string[][] = [row, nextRow];
      index += 2;

      while (index < lines.length) {
        const candidate = getPipeRowCells(lines[index] ?? "");
        if (!candidate || candidate.length !== row.length) {
          break;
        }

        tableRows.push(candidate);
        index += 1;
      }

      output.push(
        registerPreformattedBlock(formatAlignedTable(tableRows, false), blocks),
      );
      continue;
    }

    output.push(lines[index] ?? "");
    index += 1;
  }

  return {
    text: output.join("\n"),
    blocks,
  };
}

function formatAlignedTable(rows: string[][], includeDivider: boolean): string {
  const normalizedRows = rows.map((row) => row.map(normalizeTableCell));
  const widths = normalizedRows[0]?.map((_, columnIndex) =>
    Math.max(...normalizedRows.map((row) => (row[columnIndex] ?? "").length)),
  ) ?? [0];
  const lines = normalizedRows.map((row) => formatAlignedTableRow(row, widths));

  if (includeDivider && lines.length > 1) {
    lines.splice(
      1,
      0,
      widths.map((width) => "-".repeat(Math.max(width, 3))).join("-+-"),
    );
  }

  return lines.join("\n");
}

function formatAlignedTableRow(cells: string[], widths: number[]): string {
  return cells
    .map((cell, index) => cell.padEnd(widths[index] ?? cell.length))
    .join(" | ")
    .trimEnd();
}

function getPipeRowCells(line: string): string[] | undefined {
  const trimmed = line.trim();
  if (!trimmed.includes("|") || markdownTableSeparatorPattern.test(trimmed)) {
    return undefined;
  }

  const withoutEdges = trimmed.replace(/^\|/u, "").replace(/\|$/u, "");
  const cells = withoutEdges.split("|").map((cell) => cell.trim());
  if (cells.length < 3 || cells.every((cell) => cell.length === 0)) {
    return undefined;
  }

  return cells;
}

function normalizeTableCell(cell: string): string {
  return stripMarkdownEmphasis(rewriteMarkdownLinks(cell)).trim();
}

function registerPreformattedBlock(block: string, blocks: string[]): string {
  const token = `${preBlockTokenPrefix}${blocks.length}@@`;
  blocks.push(`<pre>${escapeHtml(block)}</pre>`);
  return token;
}

function restorePreformattedBlocks(text: string, blocks: string[]): string {
  return blocks.reduce(
    (result, block, index) =>
      result.replace(`${preBlockTokenPrefix}${index}@@`, block),
    text,
  );
}

function rewriteMarkdownLinks(text: string): string {
  return text.replace(
    /!?\[([^\]]+)\]\(([^)\s]+(?:\s+"[^"]+")?)\)/gu,
    (_match, label: string, target: string) => {
      if (_match.startsWith("!")) {
        return label;
      }

      const cleanTarget = target.replace(/\s+"[^"]+"$/u, "");
      return `${label} (${cleanTarget})`;
    },
  );
}

function stripMarkdownEmphasis(text: string): string {
  return text
    .replace(/`([^`]+)`/gu, "$1")
    .replace(/\*\*/gu, "")
    .replace(/__/gu, "")
    .replace(/(^|[\s(])\*([^*\n]+)\*(?=[\s).,!?:;]|$)/gmu, "$1$2")
    .replace(/(^|[\s(])_([^_\n]+)_(?=[\s).,!?:;]|$)/gmu, "$1$2");
}

function escapeHtml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function splitHtmlSegments(text: string): string[] {
  const segments: string[] = [];
  let lastIndex = 0;

  for (const match of text.matchAll(preTagPattern)) {
    const index = match.index ?? 0;
    if (index > lastIndex) {
      segments.push(text.slice(lastIndex, index));
    }

    segments.push(match[0]);
    lastIndex = index + match[0].length;
  }

  if (lastIndex < text.length) {
    segments.push(text.slice(lastIndex));
  }

  return segments.length > 0 ? segments : [text];
}

function splitPlainTextSegment(text: string, maxLength: number): string[] {
  if (text.length <= maxLength) {
    return [text];
  }

  const parts: string[] = [];
  let remaining = text;

  while (remaining.length > maxLength) {
    const slice = remaining.slice(0, maxLength);
    const boundary = Math.max(slice.lastIndexOf("\n"), slice.lastIndexOf(" "));
    const index = boundary > maxLength / 2 ? boundary : maxLength;
    parts.push(remaining.slice(0, index));
    remaining = remaining.slice(index);
  }

  if (remaining) {
    parts.push(remaining);
  }

  return parts;
}

function splitPreformattedSegment(text: string, maxLength: number): string[] {
  if (text.length <= maxLength) {
    return [text];
  }

  const content = text.slice("<pre>".length, -"</pre>".length);
  const maxContentLength = Math.max(maxLength - "<pre></pre>".length, 1);
  const lines = content.split("\n");
  const parts: string[] = [];
  let currentLines: string[] = [];
  let currentLength = 0;

  const flush = () => {
    if (currentLines.length === 0) {
      return;
    }

    parts.push(`<pre>${currentLines.join("\n")}</pre>`);
    currentLines = [];
    currentLength = 0;
  };

  for (const line of lines) {
    if (line.length > maxContentLength) {
      flush();

      let remaining = line;
      while (remaining.length > maxContentLength) {
        parts.push(`<pre>${remaining.slice(0, maxContentLength)}</pre>`);
        remaining = remaining.slice(maxContentLength);
      }

      currentLines = [remaining];
      currentLength = remaining.length;
      continue;
    }

    const lineLength = line.length + (currentLines.length > 0 ? 1 : 0);
    if (currentLength + lineLength > maxContentLength) {
      flush();
    }

    currentLines.push(line);
    currentLength += line.length + (currentLines.length > 1 ? 1 : 0);
  }

  flush();
  return parts;
}
