/**
 * scripts/__tests__/i18n-coverage.test.ts
 *
 * Unit tests for the i18n-coverage parser. These tests focus on the
 * pure-function parser (isChineseLabel, extractCandidates) so the
 * script can be tested without touching the filesystem.
 *
 * The audit's job: for every user-facing Chinese string in a TSX
 * file, decide whether it's "covered" by an existing entry in
 * `translations.ts` (i.e. an exact value match in the zh map) or
 * "missing" (a coverage gap).
 */
import { describe, expect, it } from "vitest";

import {
  isChineseLabel,
  extractCandidates,
  findJsxRanges,
} from "../i18n-coverage";

describe("isChineseLabel — character count threshold", () => {
  it("returns true for a 2+ character Chinese string", () => {
    expect(isChineseLabel("代码片段")).toBe(true);
    expect(isChineseLabel("加载中…")).toBe(true);
    expect(isChineseLabel("确认删除代码片段？此操作不可恢复。")).toBe(true);
  });

  it("returns false for short Chinese (< 2 chars)", () => {
    expect(isChineseLabel("无")).toBe(false);
    expect(isChineseLabel("是")).toBe(false);
    expect(isChineseLabel("")).toBe(false);
  });

  it("returns false for empty or whitespace-only strings", () => {
    expect(isChineseLabel("   ")).toBe(false);
    expect(isChineseLabel("\n\t")).toBe(false);
  });

  it("returns false for English / pure punctuation", () => {
    expect(isChineseLabel("Hello")).toBe(false);
    expect(isChineseLabel("!@#$%")).toBe(false);
    expect(isChineseLabel("12345")).toBe(false);
  });

  it("returns true for mixed Chinese+English UI labels", () => {
    // "Dashboard 仪表盘" — common in VControlHub nav copy
    expect(isChineseLabel("Dashboard 仪表盘")).toBe(true);
  });
});

describe("extractCandidates — JSX text content", () => {
  it("extracts a single-line JSX text node", () => {
    const text = `
      function Foo() {
        return (
          <h1>代码片段库</h1>
        );
      }
    `;
    const candidates = extractCandidates(text, findJsxRanges(text), []);
    const textNodes = candidates.filter((c) => c.kind === "text");
    expect(textNodes.length).toBe(1);
    expect(textNodes[0]!.text).toBe("代码片段库");
    expect(textNodes[0]!.line).toBe(4);
  });

  it("extracts multi-line JSX text inside the same tag", () => {
    const text = `
      function Foo() {
        return (
          <h1>
            代码片段库
          </h1>
        );
      }
    `;
    const candidates = extractCandidates(text, findJsxRanges(text), []);
    const textNodes = candidates.filter((c) => c.kind === "text");
    expect(textNodes.length).toBe(1);
    expect(textNodes[0]!.text).toBe("代码片段库");
  });

  it("ignores pure-JSX-expression text content", () => {
    const text = `
      function Foo() {
        return <h1>{snippet.title}</h1>;
      }
    `;
    const candidates = extractCandidates(text, findJsxRanges(text), []);
    expect(candidates.filter((c) => c.kind === "text")).toHaveLength(0);
  });

  it("strips JSX expressions from mixed text", () => {
    const text = `
      function Foo() {
        return <h1>共 {count} 条代码片段</h1>;
      }
    `;
    const candidates = extractCandidates(text, findJsxRanges(text), []);
    const textNodes = candidates.filter((c) => c.kind === "text");
    expect(textNodes.length).toBe(1);
    // The {count} expression becomes a space, so the text becomes
    // "共   条代码片段" — which is trimmed to "共   条代码片段"
    // containing 4+ Chinese chars (共/条/代/码/片/段) and qualifies.
    expect(textNodes[0]!.text).toMatch(/共.*条代码片段/);
  });
});

describe("extractCandidates — JSX attribute values", () => {
  it("extracts placeholder attribute", () => {
    const text = `
      function Foo() {
        return (
          <input placeholder="搜索代码片段" type="search" />
        );
      }
    `;
    const candidates = extractCandidates(text, findJsxRanges(text), []);
    const placeholders = candidates.filter((c) => c.kind === "placeholder");
    expect(placeholders).toHaveLength(1);
    expect(placeholders[0]!.text).toBe("搜索代码片段");
    expect(placeholders[0]!.attr).toBe("placeholder");
  });

  it("extracts title attribute", () => {
    const text = `
      function Foo() {
        return <button title="删除代码片段">×</button>;
      }
    `;
    const candidates = extractCandidates(text, findJsxRanges(text), []);
    const titles = candidates.filter((c) => c.kind === "title");
    expect(titles).toHaveLength(1);
    expect(titles[0]!.text).toBe("删除代码片段");
  });

  it("extracts aria-label attribute", () => {
    const text = `
      function Foo() {
        return <select aria-label="按语言过滤">…</select>;
      }
    `;
    const candidates = extractCandidates(text, findJsxRanges(text), []);
    const ariaLabels = candidates.filter((c) => c.kind === "aria-label");
    expect(ariaLabels).toHaveLength(1);
    expect(ariaLabels[0]!.text).toBe("按语言过滤");
  });

  it("extracts alt attribute", () => {
    const text = `
      function Foo() {
        return <img src="/logo.png" alt="站点 Logo" />;
      }
    `;
    const candidates = extractCandidates(text, findJsxRanges(text), []);
    const alts = candidates.filter((c) => c.kind === "alt");
    expect(alts).toHaveLength(1);
    expect(alts[0]!.text).toBe("站点 Logo");
  });

  it("skips JSX-expression attribute values", () => {
    const text = `
      function Foo() {
        return <input placeholder={t("snippets.search-placeholder")} type="search" />;
      }
    `;
    const candidates = extractCandidates(text, findJsxRanges(text), []);
    const placeholders = candidates.filter((c) => c.kind === "placeholder");
    expect(placeholders).toHaveLength(0);
  });

  it("handles single-quoted attribute values", () => {
    const text = `
      function Foo() {
        return <input placeholder='搜索代码片段' type="search" />;
      }
    `;
    const candidates = extractCandidates(text, findJsxRanges(text), []);
    const placeholders = candidates.filter((c) => c.kind === "placeholder");
    expect(placeholders).toHaveLength(1);
    expect(placeholders[0]!.text).toBe("搜索代码片段");
  });

  it("handles JSX expressions with arrow functions in attributes", () => {
    // Regression: a tag with `onClick={() => doSomething()}` used to
    // confuse the old regex-based tag parser into stopping at the
    // first `>` inside the arrow function. The brace-aware findTagEnd
    // function handles this correctly.
    const text = `
      function Foo() {
        return (
          <button onClick={() => doSomething()} title="删除代码片段">×</button>
        );
      }
    `;
    const candidates = extractCandidates(text, findJsxRanges(text), []);
    const titles = candidates.filter((c) => c.kind === "title");
    expect(titles).toHaveLength(1);
    expect(titles[0]!.text).toBe("删除代码片段");
  });
});

describe("extractCandidates — data-i18n-skip regions", () => {
  it("skips content inside a data-i18n-skip element", () => {
    const text = `
      <nav data-i18n-skip>
        <a>仪表盘</a>
        <a>设置</a>
      </nav>
    `;
    const candidates = extractCandidates(
      text,
      [{ start: 0, end: text.length }],
      [{ start: 0, end: text.length }],
    );
    expect(candidates.filter((c) => c.kind === "text")).toHaveLength(0);
  });

  it("extracts content from a non-skipped sibling element", () => {
    const text = `
      <section data-i18n-skip>
        <a>应被跳过</a>
      </section>
      <div>
        <h1>应被提取</h1>
      </div>
    `;
    const skipMatch = text.match(/<section[^>]*data-i18n-skip[^>]*>/);
    expect(skipMatch).not.toBeNull();
    const sectionEnd = text.indexOf("</section>", 0) + "</section>".length;
    // Provide a JSX range covering the whole text (so any tag inside
    // the test snippet is treated as JSX-eligible) and a skip range
    // covering just the <section data-i18n-skip> region.
    const candidates = extractCandidates(
      text,
      [{ start: 0, end: text.length }],
      [{ start: skipMatch!.index!, end: sectionEnd }],
    );
    const textNodes = candidates.filter((c) => c.kind === "text");
    expect(textNodes.length).toBe(1);
    expect(textNodes[0]!.text).toBe("应被提取");
  });
});

describe("extractCandidates — realistic VControlHub file shape", () => {
  it("handles a snippet list client component", () => {
    const text = `
export function SnippetList({ snippets: initial }: { snippets: Snippet[] }) {
  return (
    <div>
      <label htmlFor="snippets-search">搜索代码片段</label>
      <input
        id="snippets-search"
        type="search"
        placeholder="标题、内容、标签…"
      />
      <select aria-label="按语言过滤">
        <option value="ALL">全部语言</option>
      </select>
      <button onClick={...}>新建片段</button>
    </div>
  );
}
    `;
    const candidates = extractCandidates(text, findJsxRanges(text), []);
    const texts = candidates
      .filter((c) => c.kind === "text")
      .map((c) => c.text);
    expect(texts).toContain("搜索代码片段");
    expect(texts).toContain("全部语言");
    expect(texts).toContain("新建片段");
    const placeholders = candidates
      .filter((c) => c.kind === "placeholder")
      .map((c) => c.text);
    expect(placeholders).toContain("标题、内容、标签…");
    const ariaLabels = candidates
      .filter((c) => c.kind === "aria-label")
      .map((c) => c.text);
    expect(ariaLabels).toContain("按语言过滤");
  });

  it("does not pick up TypeScript type annotations as text", () => {
    const text = `
type Snippet = {
  title: string;
  description: string | null;
};
const x: Snippet = { title: "代码片段", description: null };
return <div>{x.title}</div>;
    `;
    const candidates = extractCandidates(text, findJsxRanges(text), []);
    // The "代码片段" in `title: "代码片段"` is inside a JSX expression
    // assignment, not a JSX text node — it should not be picked up.
    const texts = candidates
      .filter((c) => c.kind === "text")
      .map((c) => c.text);
    expect(texts).not.toContain("代码片段");
  });
});

describe("extractCandidates — line numbers", () => {
  it("reports 1-based line numbers", () => {
    const text = `<!-- line 1 -->
<!-- line 2 -->
<h1>代码片段库</h1>
`;
    const candidates = extractCandidates(text, findJsxRanges(text), []);
    const textNodes = candidates.filter((c) => c.kind === "text");
    expect(textNodes).toHaveLength(1);
    expect(textNodes[0]!.line).toBe(3);
  });
});
