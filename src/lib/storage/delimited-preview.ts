/** Bounded CSV/TSV preview. Never retain more than 2 MiB or 501 rows. */
export const PREVIEW_MAX_BYTES = 2 * 1024 * 1024;
export const PREVIEW_MAX_ROWS = 501; // header + 500 data rows
export const PREVIEW_MAX_COLUMNS = 200;

export function tableDelimiter(name = "", mime = ""): "," | "\t" {
  return /\.(tsv|tab)$/i.test(name) || (mime.split(";")[0] ?? "").trim() === "text/tab-separated-values" ? "\t" : ",";
}

export class DelimitedPreviewParser {
  readonly rows: string[][] = [];
  truncated = false;
  private row: string[] = [];
  private field = "";
  private quoted = false;
  private afterQuote = false;
  private skipLF = false;
  private started = false;
  private touched = false;
  constructor(private delimiter: "," | "\t", private maxRows = PREVIEW_MAX_ROWS) {}
  private endField() {
    if (this.row.length >= PREVIEW_MAX_COLUMNS) throw new Error("csvPreview.tooManyColumns");
    this.row.push(this.field);
    this.field = "";
    this.afterQuote = false;
  }
  private endRow() {
    this.endField();
    if (this.rows.length === this.maxRows) this.truncated = true;
    else this.rows.push(this.row);
    this.row = [];
    this.touched = false;
  }
  feed(text: string) {
    for (const char of text) {
      if (this.truncated) return;
      if (!this.started) { this.started = true; if (char === "\uFEFF") continue; }
      if (this.skipLF) { this.skipLF = false; if (char === "\n") continue; }
      if (this.quoted) {
        if (char === '"') { this.quoted = false; this.afterQuote = true; }
        else this.field += char;
        continue;
      }
      if (this.afterQuote && char === '"') { this.field += '"'; this.quoted = true; this.afterQuote = false; continue; }
      if (char === this.delimiter) { this.endField(); this.touched = true; }
      else if (char === "\r" || char === "\n") { this.endRow(); this.skipLF = char === "\r"; }
      else if (char === '"' && this.field === "" && !this.afterQuote) { this.quoted = true; this.touched = true; }
      else {
        if (this.afterQuote || char === '"') throw new Error("csvPreview.invalidQuotes");
        this.field += char;
        this.touched = true;
      }
    }
  }
  finish() {
    if (this.truncated) return;
    if (this.quoted) throw new Error("csvPreview.invalidQuotes");
    if (this.touched || this.row.length || this.field || this.afterQuote) this.endRow();
  }
}

export async function readDelimitedPreview(response: Response, delimiter: "," | "\t", signal?: AbortSignal) {
  signal?.throwIfAborted();
  const parser = new DelimitedPreviewParser(delimiter);
  const reader = response.body?.getReader();
  if (!reader) return { rows: parser.rows, truncated: false };
  const decoder = new TextDecoder();
  let bytes = 0;
  let ended = false;
  const abort = () => { void reader.cancel().catch(() => undefined); };
  signal?.addEventListener("abort", abort, { once: true });
  try {
    while (!parser.truncated) {
      signal?.throwIfAborted();
      const result = await reader.read();
      signal?.throwIfAborted();
      if (result.done) { ended = true; parser.feed(decoder.decode()); parser.finish(); break; }
      const available = PREVIEW_MAX_BYTES - bytes;
      const chunk = result.value.subarray(0, available);
      bytes += chunk.byteLength;
      parser.feed(decoder.decode(chunk, { stream: true }));
      if (bytes >= PREVIEW_MAX_BYTES) { parser.truncated = true; break; }
    }
    return { rows: parser.rows, truncated: parser.truncated };
  } finally {
    signal?.removeEventListener("abort", abort);
    if (!ended) await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}
