#!/usr/bin/env python3
"""
i18n backlog reporter — scans every `*-client.{tsx,ts}` component for
Chinese-string hardcodes that haven't been wired through the i18n helper.

Outputs a markdown table sorted by hardcode density (hardcode / file lines),
so the next R10G.N round can pick the highest-ROI page to attack.

Also writes a "patch template" file with suggested t() replacements for the
top-N files — useful as a starting point when i18n-ising a page manually.

Usage:
    python3 scripts/i18n-backlog.py                # write docs/i18n-backlog.md
    python3 scripts/i18n-backlog.py --top 5 --emit-templates
"""
import argparse
import os
import re
from pathlib import Path

ROOT = Path("/opt/VControlHub")
APP = ROOT / "src/app"
DOCS = ROOT / "docs"
DOCS.mkdir(exist_ok=True)

# Match: string literal containing at least one CJK char
CJK_STRING_RE = re.compile(r'"([^"\n]*[\u4e00-\u9fff][^"\n]*)"')
# Match: JSX text node (`>中文<` or `> 中 <`) — exclude things inside braces
JSX_TEXT_RE = re.compile(r'>\s*([^<>{}\n]*[\u4e00-\u9fff][^<>{}\n]*)\s*<')


def is_already_i18n(content: str) -> bool:
    return "useI18n" in content or "from \"@/lib/i18n\"" in content or "from '@/lib/i18n'" in content


def scan_file(path: Path) -> tuple[int, list[tuple[str, str]]]:
    """Return (hardcode_count, list of (kind, snippet) for first 10 examples)."""
    content = path.read_text(encoding="utf8", errors="ignore")
    if is_already_i18n(content):
        return 0, []
    examples: list[tuple[str, str]] = []
    for m in CJK_STRING_RE.finditer(content):
        s = m.group(1).strip()
        if s and len(s) >= 2:
            examples.append(("string", s[:60]))
    for m in JSX_TEXT_RE.finditer(content):
        s = m.group(1).strip()
        if s and len(s) >= 2:
            examples.append(("jsx-text", s[:60]))
    return len(examples), examples[:10]


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--top", type=int, default=15, help="how many pages to list in the backlog")
    parser.add_argument("--emit-templates", action="store_true", help="write per-file patch templates")
    args = parser.parse_args()

    results: list[tuple[str, int, int, list[tuple[str, str]]]] = []
    for dirpath, _dirs, files in os.walk(APP):
        for f in files:
            if not (f.endswith("-client.tsx") or f.endswith("-client.ts")):
                continue
            full = Path(dirpath) / f
            count, examples = scan_file(full)
            if count == 0:
                continue
            line_count = sum(1 for _ in full.open(encoding="utf8", errors="ignore"))
            rel = full.relative_to(ROOT)
            results.append((str(rel), count, line_count, examples))

    results.sort(key=lambda r: -r[1])
    out = DOCS / "i18n-backlog.md"

    lines: list[str] = []
    lines.append("# i18n Backlog")
    lines.append("")
    lines.append("Pages with the most Chinese hardcode strings left, ranked by raw count.")
    lines.append("Re-run after each R10G.N to refresh the list.")
    lines.append("")
    lines.append(f"Total unfinished pages: **{len(results)}**")
    lines.append(f"Total remaining hardcodes: **{sum(r[1] for r in results)}**")
    lines.append("")
    lines.append("| # | Page | Hardcode | Lines | Density |")
    lines.append("|---|------|---------:|------:|--------:|")
    for i, (rel, count, line_count, _ex) in enumerate(results[: args.top], 1):
        density = count / line_count if line_count else 0
        lines.append(f"| {i} | `{rel}` | {count} | {line_count} | {density:.2%} |")
    lines.append("")

    if args.emit_templates and results:
        templates_dir = DOCS / "i18n-templates"
        templates_dir.mkdir(exist_ok=True)
        lines.append(f"## Patch templates ({templates_dir})")
        lines.append("")
        for rel, count, _line_count, examples in results[: args.top]:
            stem = Path(rel).stem.replace("-client", "").replace("-", "")
            slug = re.sub(r"(?<!^)(?=[A-Z])", "-", stem).lower() + "-page"
            tpl = templates_dir / f"{slug}.md"
            tpl_lines: list[str] = []
            tpl_lines.append(f"# i18n template for `{rel}`")
            tpl_lines.append("")
            tpl_lines.append("Suggested `t()` calls and the matching keys to add to the dictionary.")
            tpl_lines.append("These are starting points — review and merge with the actual JSX.")
            tpl_lines.append("")
            tpl_lines.append(f"Add to `src/lib/i18n/dictionaries/{slug}.ts` (create if missing):")
            tpl_lines.append("")
            tpl_lines.append("```ts")
            tpl_lines.append("export const zh: Record<string, string> = {")
            for j, (kind, snippet) in enumerate(examples, 1):
                tpl_lines.append(f'\t"{slug}.snippet{j}": "{snippet}",')
            tpl_lines.append("};")
            tpl_lines.append("")
            tpl_lines.append("export const en: Record<string, string> = {")
            for j, (_kind, snippet) in enumerate(examples, 1):
                # Naive English placeholder — translator should rewrite
                tpl_lines.append(f'\t"{slug}.snippet{j}": "{snippet} (TODO: translate)",')
            tpl_lines.append("};")
            tpl_lines.append("```")
            tpl.write_text("\n".join(tpl_lines) + "\n", encoding="utf8")
            lines.append(f"- [`{rel}`](i18n-templates/{tpl.name})")
        lines.append("")

    out.write_text("\n".join(lines) + "\n", encoding="utf8")
    print(f"[ok] wrote {out} ({len(results)} pages, top {min(args.top, len(results))} listed)")
    if args.emit_templates:
        print(f"[ok] wrote templates to {DOCS / 'i18n-templates'}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
