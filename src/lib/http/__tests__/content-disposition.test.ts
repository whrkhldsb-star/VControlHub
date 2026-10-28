import { describe, expect, it } from "vitest";

import { buildContentDisposition } from "../content-disposition";

describe("buildContentDisposition", () => {
 it("uses simple filename for pure ASCII names", () => {
 const result = buildContentDisposition("attachment", "report.pdf");
 expect(result).toBe('attachment; filename="report.pdf"');
 });

 it("uses simple filename for inline ASCII names", () => {
 const result = buildContentDisposition("inline", "image.png");
 expect(result).toBe('inline; filename="image.png"');
 });

 it("sanitizes \\r \\n and \" in filenames", () => {
 const result = buildContentDisposition("attachment", 'file"name\r\n.pdf');
 expect(result).toBe('attachment; filename="file_name__.pdf"');
 });

 it("does not leave a backslash in the quoted name (it would escape the next character for the parser)", () => {
 const result = buildContentDisposition("attachment", "a\\\"b.txt");
 expect(result).toBe('attachment; filename="a__b.txt"');
 });

 it("uses RFC 5987 encoding for Chinese filenames", () => {
 const result = buildContentDisposition("attachment", "新建文档.docx");
 // Should contain: ASCII fallback filename (non-ASCII replaced with _) + filename*=UTF-8''...
 expect(result).toContain('attachment; filename="____.docx"');
 expect(result).toContain("filename*=UTF-8''");
 expect(result).toContain(encodeURIComponent("新建文档.docx"));
 });

 it("uses RFC 5987 encoding for Japanese filenames", () => {
 const result = buildContentDisposition("inline", "レポート.pdf");
 expect(result).toContain("filename*=UTF-8''");
 expect(result).toContain(encodeURIComponent("レポート.pdf"));
 });

 it("uses RFC 5987 encoding for emoji filenames", () => {
 const result = buildContentDisposition("attachment", "🎉party.txt");
 expect(result).toContain("filename*=UTF-8''");
 expect(result).toContain(encodeURIComponent("🎉party.txt"));
 });

 it("handles mixed ASCII and non-ASCII filenames", () => {
 const result = buildContentDisposition("attachment", "2026年报告.xlsx");
 expect(result).toContain("filename*=UTF-8''");
 expect(result).toContain(encodeURIComponent("2026年报告.xlsx"));
 // ASCII fallback should replace non-ASCII with underscores
 expect(result).toMatch(/filename=".*\.xlsx"/);
 });

 it("does not double-encode percent signs in already-safe names", () => {
 const result = buildContentDisposition("attachment", "100%.txt");
 // % is ASCII (0x25) so it falls in the simple path
 expect(result).toBe('attachment; filename="100%.txt"');
 });
});
