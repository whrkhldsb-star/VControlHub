// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { DelimitedPreviewParser, readDelimitedPreview, tableDelimiter, PREVIEW_MAX_BYTES } from "../delimited-preview";

function parse(text: string, delimiter: "," | "\t" = ",") {
  const parser = new DelimitedPreviewParser(delimiter);
  // Exercise every field/CRLF/escaped-quote boundary across stream chunks.
  for (const char of text) parser.feed(char);
  parser.finish();
  return parser.rows;
}

describe("bounded delimited preview", () => {
  it("parses TSV while preserving embedded commas", () => {
    expect(tableDelimiter("x.TSV", "application/octet-stream")).toBe("\t");
    expect(tableDelimiter("x", "text/tab-separated-values; charset=utf-8")).toBe("\t");
    expect(parse("name\tvalue\na,b\t1", "\t")).toEqual([["name", "value"], ["a,b", "1"]]);
  });
  it("preserves quoted commas, newlines, escaped quotes, BOM and empty trailing cells", () => {
    expect(parse('\uFEFF"first,name",value,\r\n"a\n""b",1,')).toEqual([["first,name", "value", ""], ['a\n"b', "1", ""]]);
  });
  it("does not invent an extra row after a final newline", () => {
    expect(parse("a,b\r\n1,2\r\n")).toHaveLength(2);
    expect(parse("")).toEqual([]);
  });
  it("rejects unterminated quotes and excessive columns", () => {
    expect(() => parse('a,b\n"open')).toThrow("invalidQuotes");
    expect(() => parse('"a"garbage,b')).toThrow("invalidQuotes");
    expect(() => parse(Array(202).fill("x").join(","))).toThrow("tooManyColumns");
  });
  it("cancels an unending response once the row limit is reached", async () => {
    const cancel = vi.fn();
    const stream = new ReadableStream({ pull(c) { c.enqueue(new TextEncoder().encode("a,b\n".repeat(100))); }, cancel });
    const result = await readDelimitedPreview(new Response(stream), ",");
    expect(result.rows).toHaveLength(501);
    expect(result.truncated).toBe(true);
    expect(cancel).toHaveBeenCalledOnce();
  });
  it("caps bytes without Content-Length and drops incomplete records", async () => {
    const cancel = vi.fn();
    const result = await readDelimitedPreview(new Response(new ReadableStream({
      start(c) { c.enqueue(new TextEncoder().encode('a,b\n"' + "x".repeat(PREVIEW_MAX_BYTES + 50))); }, cancel,
    })), ",");
    expect(result).toEqual({ rows: [["a", "b"]], truncated: true });
    expect(cancel).toHaveBeenCalledOnce();
  });
  it("handles split UTF-8 characters", async () => {
    const bytes = new TextEncoder().encode("名,值\n甲,乙");
    let index = 0;
    const response = new Response(new ReadableStream({ pull(c) { if (index < bytes.length) c.enqueue(bytes.slice(index, ++index)); else c.close(); } }));
    expect((await readDelimitedPreview(response, ",")).rows).toEqual([["名", "值"], ["甲", "乙"]]);
  });
  it("abort cancels a stalled reader", async () => {
    const controller = new AbortController();
    const cancel = vi.fn();
    const promise = readDelimitedPreview(new Response(new ReadableStream({ cancel })), ",", controller.signal);
    controller.abort();
    await expect(promise).rejects.toThrow();
    expect(cancel).toHaveBeenCalledOnce();
  });
});
