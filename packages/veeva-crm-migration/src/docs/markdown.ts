/**
 * Small GitHub-flavoured Markdown helpers shared by the doc renderers.
 *
 * Every piece of user data that ends up in a table cell must go through
 * {@link esc} or {@link code} so pipes and newlines cannot break the table.
 * {@link table} deliberately does not escape: callers build cells from these
 * helpers so a code span is never double-escaped.
 */

/** Plain-text table cell: pipes escaped, newlines folded to `<br>`. */
export function esc(value: unknown): string {
  const s = value === null || value === undefined ? "" : String(value);
  return s.replace(/\r?\n/g, "<br>").replace(/\|/g, "\\|").trim();
}

/** Inline code span safe inside a table cell (pipes escaped, backticks handled). */
export function code(value: unknown): string {
  const s = value === null || value === undefined ? "" : String(value);
  if (!s) return "";
  const flat = s
    .replace(/\s*\r?\n\s*/g, " ")
    .replace(/\|/g, "\\|")
    .trim();
  return flat.includes("`") ? `\`\` ${flat} \`\`` : `\`${flat}\``;
}

/** Fenced code block; the body is emitted verbatim (never inside a table). */
export function fence(body: string, lang = ""): string {
  const text = body.replace(/\r\n/g, "\n").trimEnd();
  const ticks = /```/.test(text) ? "````" : "```";
  return `${ticks}${lang}\n${text}\n${ticks}\n`;
}

/** `✓` / `·` for booleans. */
export function check(value: boolean | undefined | null): string {
  return value ? "✓" : "·";
}

/**
 * GFM table. Returns `empty` (a short italic sentence) instead of a table
 * with no rows — an empty table renders as a bare header in GitHub.
 */
export function table(
  headers: readonly string[],
  rows: readonly (readonly string[])[],
  empty = "_None._",
): string {
  if (!rows.length) return `${empty}\n`;
  const line = (cells: readonly string[]) =>
    `| ${headers
      .map((_, i) => cells[i] ?? "")
      .map((c) => (c === "" ? " " : c))
      .join(" | ")} |`;
  return (
    [
      line(headers),
      `|${headers.map(() => "---").join("|")}|`,
      ...rows.map(line),
    ].join("\n") + "\n"
  );
}

/** Bullet list; `empty` when there is nothing to list. */
export function bullets(items: readonly string[], empty = "_None._"): string {
  if (!items.length) return `${empty}\n`;
  return items.map((i) => `- ${i}`).join("\n") + "\n";
}

/** Task-list checklist (`- [ ] …`). */
export function checklist(items: readonly string[], empty = "_None._"): string {
  if (!items.length) return `${empty}\n`;
  return items.map((i) => `- [ ] ${i}`).join("\n") + "\n";
}

/** Collapsible block; the body is separated by blank lines so tables render inside. */
export function details(summary: string, body: string): string {
  return `<details>\n<summary>${summary}</summary>\n\n${body.trimEnd()}\n\n</details>\n`;
}

export function link(text: string, href: string): string {
  return `[${esc(text)}](${href})`;
}

/** Truncates long free text for a table cell. */
export function clip(value: string, max = 120): string {
  const flat = value.replace(/\s+/g, " ").trim();
  return flat.length <= max ? flat : `${flat.slice(0, max - 1)}…`;
}

/** Code-point string comparison — stable across locales, unlike `localeCompare`. */
export function cmp(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function sorted<T>(
  items: readonly T[],
  ...keys: ((item: T) => string | number)[]
): T[] {
  return [...items].sort((a, b) => {
    for (const key of keys) {
      const ka = key(a);
      const kb = key(b);
      const r =
        typeof ka === "number" && typeof kb === "number"
          ? ka - kb
          : cmp(String(ka), String(kb));
      if (r) return r;
    }
    return 0;
  });
}

export function unique(items: readonly string[]): string[] {
  return [...new Set(items)].sort(cmp);
}

/** Joins document fragments; each fragment ends with exactly one newline. */
export function joinDoc(parts: readonly string[]): string {
  return (
    parts
      .map((p) => p.replace(/\n+$/, ""))
      .filter((p) => p.length)
      .join("\n\n") + "\n"
  );
}
