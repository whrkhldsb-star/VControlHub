/* eslint-disable @next/next/no-img-element */
"use client";

import type React from "react";

/* ── Escape HTML to prevent XSS ──────────────────────────────── */
export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

/* ── Copy to clipboard ──────────────────────────────────────── */
export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/* ── Render inline markdown (bold, italic, code, links, strikethrough) ─ */
export const renderInline = (text: string): React.ReactNode[] => {
 // Split by inline code first, then process formatting in non-code parts
 const codeParts = text.split(/(`[^`]+`)/g);
 const result: React.ReactNode[] = [];
 codeParts.forEach((cp, ci) => {
 if (cp.startsWith("`") && cp.endsWith("`")) {
 result.push(
 <code key={`c-${ci}`} className="bg-black/30 px-1.5 py-0.5 rounded text-cyan-300 text-xs">
 {cp.slice(1, -1)}
 </code>
 );
 return;
 }
 // Process formatting: **bold**, *italic*, ~~strike~~, [link](url)
 const fmtParts = cp.split(/(\*\*[^*]+\*\*|\*[^*]+\*|~~[^~]+~~|\[[^\]]+\]\([^)]+\))/g);
 fmtParts.forEach((fp, fi) => {
 if (fp.startsWith("**") && fp.endsWith("**")) {
 result.push(<strong key={`b-${ci}-${fi}`}>{fp.slice(2, -2)}</strong>);
 } else if (fp.startsWith("*") && fp.endsWith("*") && !fp.startsWith("**")) {
 result.push(<em key={`i-${ci}-${fi}`}>{fp.slice(1, -1)}</em>);
 } else if (fp.startsWith("~~") && fp.endsWith("~~")) {
 result.push(<s key={`s-${ci}-${fi}`}>{fp.slice(2, -2)}</s>);
 } else if (/^\[.+\]\(.+\)$/.test(fp)) {
 const linkMatch = fp.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
 if (linkMatch) {
 result.push(
 <a key={`a-${ci}-${fi}`} href={linkMatch[2]} target="_blank" rel="noopener noreferrer"
 className="text-cyan-400 hover:text-cyan-300 underline decoration-cyan-400/30">
 {linkMatch[1]}
 </a>
 );
 } else {
 result.push(<span key={`t-${ci}-${fi}`}>{escapeHtml(fp)}</span>);
 }
 } else {
 result.push(<span key={`t-${ci}-${fi}`}>{escapeHtml(fp)}</span>);
 }
 });
 });
 return result;
};

/* ── Render Message Content (full markdown: headings, lists, links, code, tables) ─ */
export const renderContent = (content: string) => {
 // 1. Extract fenced code blocks first (they must not be processed)
 const codeBlocks: string[] = [];
 const withoutCode = content.replace(/(```[\s\S]*?```)/g, (m) => {
 codeBlocks.push(m);
 return `\x00CODE${codeBlocks.length - 1}\x00`;
 });

 // 2. Split into lines for block-level processing
 const lines = withoutCode.split("\n");
 const elements: React.ReactNode[] = [];
 let i = 0;
 let listItems: string[] = [];
 let listType: "ul" | "ol" | null = null;
	let tableRows: string[][] = [];

 const flushList = () => {
 if (listItems.length > 0) {
 const Tag = listType === "ol" ? "ol" : "ul";
 elements.push(
 <Tag key={`list-${elements.length}`} className={`ml-4 my-1.5 ${listType === "ol" ? "list-decimal" : "list-disc"} text-xs text-slate-300 space-y-0.5`}>
 {listItems.map((li, liIdx) => (
 <li key={liIdx}>{renderInline(li)}</li>
 ))}
 </Tag>
 );
 listItems = [];
 listType = null;
 }
 };

 const flushTable = () => {
 if (tableRows.length > 0) {
 elements.push(
 <div key={`tbl-${elements.length}`} className="my-2 overflow-x-auto">
 <table className="text-xs border-collapse w-full">
 <thead>
 <tr>
 {tableRows[0]?.map((cell, ci) => (
 <th key={ci} className="border border-white/10 px-2 py-1 text-left text-cyan-400/80 bg-black/20">{renderInline(cell)}</th>
 ))}
 </tr>
 </thead>
 <tbody>
 {tableRows.slice(1).map((row, ri) => (
 <tr key={ri}>
 {row.map((cell, ci) => (
 <td key={ci} className="border border-white/10 px-2 py-1 text-slate-300">{renderInline(cell)}</td>
 ))}
 </tr>
 ))}
 </tbody>
 </table>
 </div>
 );
		tableRows = [];
	}
 };

 while (i < lines.length) {
 const line = lines[i];

 // Check for code block placeholder
 const codeMatch = line.match(/^\x00CODE(\d+)\x00$/);
 if (codeMatch) {
 flushList();
 flushTable();
 const block = codeBlocks[parseInt(codeMatch[1])];
 const blockLines = block.slice(3, -3).split("\n");
 const lang = blockLines[0]?.trim() || "";
 const code = lang ? blockLines.slice(1).join("\n") : blockLines.join("\n");
 elements.push(
 <div key={`cb-${elements.length}`} className="relative group/code bg-black/40 rounded-lg my-2 overflow-hidden">
 <div className="flex items-center justify-between px-3 py-1.5 border-b border-white/5">
 <span className="text-[10px] text-cyan-400/60 font-mono">{lang || "code"}</span>
 <button
 onClick={() => copyToClipboard(code)}
 className="text-[10px] text-slate-500 hover:text-cyan-300 transition opacity-0 group-hover/code:opacity-100 flex items-center gap-1"
 >
 <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
 <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
 </svg>
 复制
 </button>
 </div>
 <pre className="p-3 overflow-x-auto text-xs leading-relaxed">
 <code>{code}</code>
 </pre>
 </div>
 );
 i++;
 continue;
 }

 // Headings: # ## ### etc.
 const headingMatch = line.match(/^(#{1,6})\s+(.+)$/);
 if (headingMatch) {
 flushList(); flushTable();
 const level = headingMatch[1].length;
 const sizes: Record<number, string> = {
 1: "text-base font-bold", 2: "text-sm font-bold", 3: "text-sm font-semibold",
 4: "text-xs font-semibold", 5: "text-xs font-medium", 6: "text-xs font-medium text-slate-400",
 };
 elements.push(
 <div key={`h-${elements.length}`} className={`${sizes[level] || "text-xs"} text-white mt-3 mb-1`}>
 {renderInline(headingMatch[2])}
 </div>
 );
 i++;
 continue;
 }

 // Unordered list: - or * with space
 const ulMatch = line.match(/^[\s]*[-*]\s+(.+)$/);
 if (ulMatch) {
 flushTable();
 if (listType !== "ul") { flushList(); listType = "ul"; }
 listItems.push(ulMatch[1]);
 i++;
 continue;
 }

 // Ordered list: 1. 2. etc.
 const olMatch = line.match(/^[\s]*\d+\.\s+(.+)$/);
 if (olMatch) {
 flushTable();
 if (listType !== "ol") { flushList(); listType = "ol"; }
 listItems.push(olMatch[1]);
 i++;
 continue;
 }

 // Table row: | cell | cell |
 const tableMatch = line.match(/^\|(.+)\|$/);
 if (tableMatch) {
 flushList();
 const cells = tableMatch[1].split("|").map(c => c.trim());
 // Skip separator row: |---|---|
 if (cells.every(c => /^[-:]+$/.test(c))) {
 i++;
 continue;
 }
		tableRows.push(cells);
		i++;
 continue;
 }

 // Horizontal rule: --- or ***
 if (/^[-*_]{3,}\s*$/.test(line.trim())) {
 flushList(); flushTable();
 elements.push(<hr key={`hr-${elements.length}`} className="border-white/10 my-3" />);
 i++;
 continue;
 }

 // Blank line → paragraph break
 if (line.trim() === "") {
 flushList(); flushTable();
 i++;
 continue;
 }

 // Default: paragraph text
 flushList(); flushTable();
 // Collect consecutive text lines as one paragraph
 const paraLines: string[] = [];
 while (i < lines.length) {
 const l = lines[i];
 if (l.trim() === "" || l.match(/^\x00CODE/) || l.match(/^#{1,6}\s+/) ||
 l.match(/^[\s]*[-*]\s+/) || l.match(/^[\s]*\d+\.\s+/) || l.match(/^\|/)) break;
 paraLines.push(l);
 i++;
 }
 if (paraLines.length > 0) {
 elements.push(
 <p key={`p-${elements.length}`} className="my-1">
 {renderInline(paraLines.join("\n"))}
 </p>
 );
 }
 }

 flushList();
 flushTable();

 return elements;
};
