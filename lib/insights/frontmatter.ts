/**
 * Minimal hand-rolled frontmatter parser — no gray-matter dependency.
 * Mirrors the Phase 1 established pattern.
 *
 * Parses YAML-like frontmatter blocks delimited by `---` lines.
 * Supports: strings, numbers, booleans, simple string arrays.
 */
export function parseFrontmatter(text: string): Record<string, unknown> {
  // Must start with literal `---\n`
  if (!text.startsWith("---\n")) {
    return {};
  }

  // Find the closing `---` — the next line that is exactly `---`
  const afterOpen = text.slice(4); // skip the leading `---\n`
  const closingIndex = afterOpen.search(/^---$/m);
  if (closingIndex === -1) {
    return {};
  }

  const block = afterOpen.slice(0, closingIndex);
  const record: Record<string, unknown> = {};

  for (const line of block.split("\n")) {
    const match = line.match(/^(\w[\w-]*):\s*(.*)$/);
    if (!match) continue;

    const key = match[1]!;
    const rawValue = match[2]!.trim();

    record[key] = coerceValue(rawValue);
  }

  return record;
}

export function coerceValue(raw: string): unknown {
  // Boolean
  if (raw === "true") return true;
  if (raw === "false") return false;

  // Array: [a, b, c]
  if (raw.startsWith("[") && raw.endsWith("]")) {
    const inner = raw.slice(1, -1);
    return inner
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
  }

  // Number: pure integer or decimal
  if (/^-?(\d+|\d*\.\d+)$/.test(raw)) {
    return parseFloat(raw);
  }

  // Raw string
  return raw;
}
