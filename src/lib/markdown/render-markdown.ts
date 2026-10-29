import { escapeHtml } from "@/lib/sanitize/escape-html";

/**
 * Simple regex-based Markdown-to-HTML converter.
 * Supports: headings, bold, italic, fenced code blocks, inline code,
 * links, ordered/unordered lists, blockquotes, tables, horizontal rules.
 */
/** Above this size the document is shown as plain text: the inline regexes' backtracking grows with the input. */
export const MAX_RENDERED_MARKDOWN_CHARS = 512_000;
/** What a fenced block's language may be: it becomes part of a class name. */
const FENCE_LANGUAGE = /^[A-Za-z0-9_+#.-]{1,32}$/;

export function renderMarkdown(md: string): string {
  if (md.length > MAX_RENDERED_MARKDOWN_CHARS) return `<pre>${escapeHtml(md)}</pre>`;
  // Normalize line endings
  const src = md.replace(/\r\n/g, "\n").replace(/\r/g, "\n");

  const lines = src.split("\n");
  const out: string[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i]!;

    // ---- Fenced code block ----
    const fenceMatch = line.match(/^(`{3,})(.*)$/);
    if (fenceMatch) {
      const fence = fenceMatch[1]!;
      const lang = fenceMatch[2]!.trim();
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !lines[i]!.startsWith(fence)) {
        codeLines.push(lines[i]!);
        i++;
      }
      i++; // skip closing fence
      const langClass = FENCE_LANGUAGE.test(lang) ? ` class="language-${lang}"` : "";
      out.push(
        `<pre><code${langClass}>${escapeHtml(codeLines.join("\n"))}</code></pre>`,
      );
      continue;
    }

    // ---- Empty line ----
    if (line.trim() === "") {
      i++;
      continue;
    }

    // ---- Heading ----
    const headingMatch = line.match(/^(#{1,6})\s+(.*)$/);
    if (headingMatch) {
      const level = headingMatch[1]!.length;
      const text = inlineFormat(headingMatch[2]!);
      out.push(`<h${level}>${text}</h${level}>`);
      i++;
      continue;
    }

    // ---- Horizontal rule ----
    if (/^(\s*[-*_]){3,}\s*$/.test(line)) {
      out.push("<hr />");
      i++;
      continue;
    }

    // ---- Table ----
    const tableBlock = tryParseTable(lines, i);
    if (tableBlock) {
      out.push(tableBlock.html);
      i = tableBlock.nextLine;
      continue;
    }

    // ---- Blockquote ----
    if (/^>\s?/.test(line)) {
      const quoteLines: string[] = [];
      while (i < lines.length && /^>\s?/.test(lines[i]!)) {
        quoteLines.push(lines[i]!.replace(/^>\s?/, ""));
        i++;
      }
      out.push(
        `<blockquote>${inlineFormat(quoteLines.join("\n"))}</blockquote>`,
      );
      continue;
    }

    // ---- Unordered list ----
    if (/^[\s]*[-*+]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^[\s]*[-*+]\s+/.test(lines[i]!)) {
        items.push(inlineFormat(lines[i]!.replace(/^[\s]*[-*+]\s+/, "")));
        i++;
      }
      out.push(`<ul>${items.map((it) => `<li>${it}</li>`).join("")}</ul>`);
      continue;
    }

    // ---- Ordered list ----
    if (/^[\s]*\d+\.\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^[\s]*\d+\.\s+/.test(lines[i]!)) {
        items.push(inlineFormat(lines[i]!.replace(/^[\s]*\d+\.\s+/, "")));
        i++;
      }
      out.push(`<ol>${items.map((it) => `<li>${it}</li>`).join("")}</ol>`);
      continue;
    }

    // ---- Paragraph (default) ----
    const paraLines: string[] = [];
    while (
      i < lines.length &&
      lines[i]!.trim() !== "" &&
      !/^#{1,6}\s/.test(lines[i]!) &&
      !/^(\s*[-*_]){3,}\s*$/.test(lines[i]!) &&
      !/^>\s?/.test(lines[i]!) &&
      !/^[\s]*[-*+]\s+/.test(lines[i]!) &&
      !/^[\s]*\d+\.\s+/.test(lines[i]!) &&
      !/^`{3,}/.test(lines[i]!) &&
      // Only a row that really starts a table (a separator follows) ends the
      // paragraph. Any "| … |" line stopped it, and a lone one that was not a
      // table either was consumed by nothing: the loop spun on it forever.
      !(isTableRow(lines[i]!) && isTableSeparator(lines[i + 1] ?? ""))
    ) {
      paraLines.push(lines[i]!);
      i++;
    }
    if (paraLines.length === 0) {
      // Never leave a line unconsumed.
      out.push(`<p>${inlineFormat(lines[i]!)}</p>`);
      i++;
    } else {
      // Format each line individually, then join with <br /> AFTER escaping
      // (escapeHtml in inlineFormat would escape <br /> into literal text)
      const formatted = paraLines.map((line) => inlineFormat(line));
      out.push(`<p>${formatted.join("<br />")}</p>`);
    }
  }

  return out.join("\n");
}

function isAllowedMarkdownLink(rawUrl: string): boolean {
  const trimmed = rawUrl.trim();
  const lower = trimmed.toLowerCase();
  if (lower.startsWith("/") && !lower.startsWith("//")) return true;
  try {
    const parsed = new URL(trimmed);
    return ["http:", "https:", "mailto:"].includes(parsed.protocol);
  } catch {
    return false;
  }
}

/** Apply inline Markdown formatting (bold, italic, code, links) */
function inlineFormat(text: string): string {
  // Escaping the whole text is what keeps it inert: no tag or attribute can
  // form, and links are allowed only to http(s)/mailto/relative URLs. A filter
  // that deleted "on…=" and "data:" substrings first only mangled prose and
  // inline code — "max_connections=200" rendered as "max_c".
  text = escapeHtml(text).replace(/[\uE000\uE001]/g, "");
  // Inline code is set aside while emphasis and links are applied, and put
  // back last: run over it, `**keep**` turned bold, `2 * 3 * 4` lost its
  // stars and a literal `[a](url)` became a link.
  const codeSpans: string[] = [];
  text = text.replace(/`([^`]+)`/g, (_match, code: string) => `\uE000${codeSpans.push(code) - 1}\uE001`);
  // Bold + italic
  text = text.replace(/\*\*\*(.+?)\*\*\*/g, "<strong><em>$1</em></strong>");
  // Bold
  text = text.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  // Italic
  text = text.replace(/\*(.+?)\*/g, "<em>$1</em>");
  // Sanitize link URLs to prevent javascript: protocol XSS
  text = text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (match, text, url) => {
    const trimmed = url.trim();
    if (!isAllowedMarkdownLink(trimmed)) {
      return match; // Leave dangerous or unsupported links as escaped plain text
    }
    // Both were escaped with the rest of the line above; escaping again turned
    // "a&b" into "a&amp;amp;b" and broke URLs with query strings.
    return `<a href="${trimmed}" target="_blank" rel="noopener noreferrer">${text}</a>`;
  });
  return text.replace(/\uE000(\d+)\uE001/g, (_match, index: string) => `<code>${codeSpans[Number(index)]}</code>`);
}

/** Check if a line looks like a table row */
function isTableRow(line: string): boolean {
  return /^\|.*\|$/.test(line.trim());
}

/** Check if a line is a table separator row (|---|---|) */
function isTableSeparator(line: string): boolean {
  return /^\|[\s\-:]+\|/.test(line.trim());
}

/** Try to parse a table starting at line index `start`. Returns HTML + next line index, or null. */
function tryParseTable(
  lines: string[],
  start: number,
): { html: string; nextLine: number } | null {
  if (start >= lines.length || !isTableRow(lines[start]!)) return null;

  const headerLine = lines[start]!.trim();
  // Must have a separator row next
  if (start + 1 >= lines.length || !isTableSeparator(lines[start + 1]!))
    return null;

  const headers = parseTableRow(headerLine);
  const aligns = parseTableAligns(lines[start + 1]!.trim());

  let i = start + 2;
  const bodyRows: string[][] = [];
  while (i < lines.length && isTableRow(lines[i]!)) {
    bodyRows.push(parseTableRow(lines[i]!.trim()));
    i++;
  }

  const headerHtml = headers
    .map((h, idx) => {
      const align = aligns[idx] ? ` class="align-${aligns[idx]}"` : "";
      return `<th${align}>${inlineFormat(h)}</th>`;
    })
    .join("");

  const bodyHtml = bodyRows
    .map((row) => {
      const cells = row
        .map((c, idx) => {
          const align = aligns[idx] ? ` class="align-${aligns[idx]}"` : "";
          return `<td${align}>${inlineFormat(c)}</td>`;
        })
        .join("");
      return `<tr>${cells}</tr>`;
    })
    .join("");

  return {
    html: `<table><thead><tr>${headerHtml}</tr></thead><tbody>${bodyHtml}</tbody></table>`,
    nextLine: i,
  };
}

/** Split | cell | cell | into an array of trimmed cell strings */
function parseTableRow(line: string): string[] {
  return line
    .split("|")
    .slice(1, -1)
    .map((c) => c.trim());
}

/** Parse alignment from separator row: :---: = center, :--- = left, ---: = right */
function parseTableAligns(line: string): string[] {
  return line
    .split("|")
    .slice(1, -1)
    .map((c) => {
      const cell = c.trim();
      if (cell.startsWith(":") && cell.endsWith(":")) return "center";
      if (cell.endsWith(":")) return "right";
      if (cell.startsWith(":")) return "left";
      return "";
    });
}

/**
 * Plain text of a Markdown source, for one- or two-line excerpts where
 * markup would only show as stray symbols. Code is copied as written: the
 * markup rules turned `__init__` into "init" and dropped a `---` line inside
 * a fenced block, so the excerpt said something the body did not.
 */
export function markdownToPlainText(md: string): string {
  const out: string[] = [];
  let prose: string[] = [];
  let inFence = false;
  const flushProse = () => {
    if (prose.length) out.push(proseToPlainText(prose.join("\n")));
    prose = [];
  };
  for (const line of md.replace(/\r\n?/g, "\n").split("\n")) {
    if (/^[ \t]{0,3}```/.test(line)) {
      flushProse();
      inFence = !inFence;
      continue;
    }
    if (inFence) out.push(line);
    else prose.push(line);
  }
  flushProse();
  return out.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

function proseToPlainText(text: string): string {
  // Inline code spans are set aside first and put back verbatim.
  const spans: string[] = [];
  return text
    .replace(/`([^`\n]+)`/g, (_, code: string) => `\u0000${spans.push(code) - 1}\u0000`)
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/^[ \t]{0,3}#{1,6}[ \t]+/gm, "")
    .replace(/^[ \t]{0,3}>[ \t]?/gm, "")
    .replace(/^[ \t]*(?:[-*+]|\d+[.)])[ \t]+/gm, "")
    .replace(/^[ \t]*\|?[ \t]*:?-{3,}.*$/gm, "")
    .replace(/(\*\*\*|\*\*|\*|__|_)(\S(?:.*?\S)?)\1/g, "$2")
    .replace(/\|/g, " ")
    .replace(/\u0000(\d+)\u0000/g, (_, index: string) => spans[Number(index)] ?? "");
}

/** One paragraph of plain text, for line-clamped previews (dashboard, banners). */
export function markdownExcerpt(md: string): string {
  return markdownToPlainText(md).replace(/\s+/g, " ").trim();
}

export const MARKDOWN_PROSE_CLASS = [
  "prose prose-invert max-w-none text-sm leading-relaxed",
  "[&_a]:text-[var(--color-action-text)] [&_a]:underline [&_a:hover]:text-[var(--color-action-text)]",
  "[&_blockquote]:border-l-4 [&_blockquote]:border-[var(--border)] [&_blockquote]:pl-4 [&_blockquote]:italic [&_blockquote]:text-[var(--text-secondary)]",
  "[&_code]:rounded [&_code]:bg-[var(--surface)] [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:text-[var(--color-action-text)]",
  "[&_h1]:mt-6 [&_h1]:mb-3 [&_h1]:text-2xl [&_h1]:font-bold [&_h1]:text-[var(--text-primary)]",
  "[&_h2]:mt-5 [&_h2]:mb-2 [&_h2]:text-xl [&_h2]:font-bold [&_h2]:text-[var(--text-primary)]",
  "[&_h3]:mt-4 [&_h3]:mb-2 [&_h3]:text-lg [&_h3]:font-semibold [&_h3]:text-[var(--text-primary)]",
  "[&_h4]:mt-3 [&_h4]:mb-1.5 [&_h4]:text-base [&_h4]:font-semibold [&_h4]:text-[var(--text-primary)]",
  "[&_h5]:mt-3 [&_h5]:mb-1 [&_h5]:text-sm [&_h5]:font-semibold [&_h5]:text-[var(--text-primary)]",
  "[&_h6]:mt-3 [&_h6]:mb-1 [&_h6]:text-sm [&_h6]:font-semibold [&_h6]:text-[var(--text-secondary)]",
  "[&_hr]:border-[var(--border)] [&_hr]:my-4 [&_li]:text-[var(--text-primary)]",
  "[&_ol]:list-decimal [&_ol]:pl-6 [&_ol]:my-2 [&_ul]:list-disc [&_ul]:pl-6 [&_ul]:my-2",
  "[&_p]:my-2 [&_p]:text-[var(--text-primary)] [&_strong]:text-[var(--text-primary)] [&_strong]:font-semibold",
  "[&_pre]:rounded-xl [&_pre]:bg-[var(--surface)] [&_pre]:p-4 [&_pre]:my-3 [&_pre]:overflow-x-auto [&_pre]:border [&_pre]:border-[var(--border)]",
  "[&_table]:w-full [&_table]:my-3 [&_table]:border-collapse",
  "[&_td.align-center]:text-center [&_td.align-right]:text-right [&_td]:border [&_td]:border-[var(--border)] [&_td]:px-3 [&_td]:py-2 [&_td]:text-[var(--text-primary)]",
  "[&_th.align-center]:text-center [&_th.align-right]:text-right [&_th]:border [&_th]:border-[var(--border)] [&_th]:bg-[var(--surface)] [&_th]:px-3 [&_th]:py-2 [&_th]:text-left [&_th]:font-semibold [&_th]:text-[var(--text-primary)]",
].join(" ");

/** The same styles at body size with tighter spacing, for short texts inside cards. */
export const MARKDOWN_COMPACT_CLASS = [
  MARKDOWN_PROSE_CLASS,
  "[&_p]:my-1.5 [&_p]:text-[var(--text-secondary)] [&_li]:text-[var(--text-secondary)] [&_ul]:my-1.5 [&_ol]:my-1.5",
  "[&>:first-child]:mt-0 [&>:last-child]:mb-0",
].join(" ");
