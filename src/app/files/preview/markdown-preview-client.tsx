"use client";

import { useState, useEffect, useMemo } from "react";
import { useI18n } from "@/lib/i18n/use-locale";
type PreviewState =
  | { loading: true }
  | { loading: false; content: string | null; error: string | null };

/**
 * Simple regex-based Markdown-to-HTML converter.
 * Supports: headings, bold, italic, fenced code blocks, inline code,
 * links, ordered/unordered lists, blockquotes, tables, horizontal rules.
 */
export function renderMarkdown(md: string): string {
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
      const langClass = lang ? ` class="language-${escapeHtml(lang)}"` : "";
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
      !isTableRow(lines[i]!)
    ) {
      paraLines.push(lines[i]!);
      i++;
    }
    if (paraLines.length > 0) {
      // Format each line individually, then join with <br /> AFTER escaping
      // (escapeHtml in inlineFormat would escape <br /> into literal text)
      const formatted = paraLines.map((line) => inlineFormat(line));
      out.push(`<p>${formatted.join("<br />")}</p>`);
    }
  }

  return out.join("\n");
}

/** Escape HTML special characters */
function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function stripDangerousText(text: string): string {
  return text
    .replace(/on\w+\s*=\s*[^\s)]+/gi, "")
    .replace(/\b(?:javascript|data|vbscript):/gi, "");
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
  text = escapeHtml(stripDangerousText(text));
  // Inline code (must be before bold/italic to avoid conflicts)
  text = text.replace(/`([^`]+)`/g, "<code>$1</code>");
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
    return `<a href="${escapeHtml(trimmed)}" target="_blank" rel="noopener noreferrer">${escapeHtml(text)}</a>`;
  });
  return text;
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

const MARKDOWN_PROSE_CLASS = [
  "prose prose-invert max-w-none text-sm leading-relaxed",
  "[&_a]:text-[var(--color-action)] [&_a]:underline [&_a:hover]:text-[var(--color-action)]",
  "[&_blockquote]:border-l-4 [&_blockquote]:border-[var(--border)] [&_blockquote]:pl-4 [&_blockquote]:italic [&_blockquote]:text-[var(--text-secondary)]",
  "[&_code]:rounded [&_code]:bg-[var(--surface)] [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:text-[var(--color-action)]",
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

export function MarkdownPreviewClient({ href }: { href: string }) {
  const { t } = useI18n();
  const [state, setState] = useState<PreviewState>({ loading: true });
  const [sanitizeFn, setSanitizeFn] = useState<
    ((html: string) => string) | null
  >(null);

  useEffect(() => {
    let cancelled = false;
    import("@/lib/sanitize/html-sanitizer").then((m) => {
      if (!cancelled) setSanitizeFn(() => m.sanitizeHtml);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    fetch(href)
      .then(async (res) => {
        if (!res.ok)
          throw new Error(
            t("markdownPreview.loadFailedWithStatus").replace(
              "{status}",
              String(res.status),
            ),
          );
        const text = await res.text();
        if (!cancelled) {
          setState({ loading: false, content: text, error: null });
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setState({
            loading: false,
            content: null,
            error:
              err instanceof Error
                ? err.message
                : t("markdownPreview.loadFailed"),
          });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [href, t]);

  const html = useMemo(
    () =>
      sanitizeFn
        ? sanitizeFn(
            renderMarkdown((state as { content?: string }).content ?? ""),
          )
        : "",
    [state, sanitizeFn],
  );

  if (state.loading) {
    return (
      <div className="flex items-center justify-center py-16 text-[var(--text-secondary)]">
        <span className="animate-pulse text-sm">
          {t("markdownPreview.loading")}
        </span>
      </div>
    );
  }

  if (state.error) {
    return (
      <div className="flex flex-col items-center gap-3 py-16 text-[var(--danger)]">
        <span className="text-3xl">⚠️</span>
        <p className="text-sm">{state.error}</p>
      </div>
    );
  }

  if (!sanitizeFn) {
    return (
      <div className="flex items-center justify-center py-16 text-[var(--text-secondary)]">
        <span className="animate-pulse text-sm">
          {t("markdownPreview.loading")}
        </span>
      </div>
    );
  }

  return (
    <div className="overflow-auto rounded-2xl bg-[var(--surface)] p-4">
      {/* Label */}
      <div className="mb-3 flex items-center gap-2">
        <span
          data-tone="cyan"
          className="rounded-lg border border-[var(--color-action-border)]/30 px-3 py-1 text-xs text-[var(--color-action)]"
        >
          {t("markdownPreview.title")}
        </span>
      </div>

      {/* Rendered markdown */}
      <div
        className={MARKDOWN_PROSE_CLASS}
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </div>
  );
}
