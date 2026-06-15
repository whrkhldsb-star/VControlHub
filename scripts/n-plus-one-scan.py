#!/usr/bin/env python3
"""N+1 pattern finder — locate `for`/`forEach`/`.map(async)` blocks whose body
contains a `prisma.X.{findMany,findUnique,...}` call, in src/lib and src/app.

Heuristic only; the output is a triage list, not a final audit.
"""
import re
import sys
import glob
from pathlib import Path

PRISMA_LOOKUP_RE = re.compile(
    r"prisma\.(\w+)\.(findMany|findUnique|findFirst|count|aggregate|create|update|delete|upsert)\b"
)
LOOP_BLOCK_RE = re.compile(
    r"(?P<loop>"
    r"\bfor\s*\([^)]*\)\s*\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\}"
    r"|\.forEach\s*\(\s*(?:async\s*)?\([^)]*\)\s*=>\s*\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\}"
    r"|\.map\s*\(\s*async\s*\([^)]*\)\s*=>\s*\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\}"
    r")",
    re.DOTALL,
)
FUNC_HEADER_RE = re.compile(
    r"(?:export\s+)?(?:async\s+)?function\s+(\w+)\b[^{]*\{",
    re.MULTILINE,
)

def find_matching_brace(text: str, open_pos: int) -> int:
    """Return the index just past the matching `}` for the `{` at open_pos."""
    depth = 1
    i = open_pos + 1
    while i < len(text) and depth > 0:
        c = text[i]
        if c == "{":
            depth += 1
        elif c == "}":
            depth -= 1
        i += 1
    return i - 1 if depth == 0 else -1

def scan(path: Path):
    text = path.read_text(encoding="utf-8")
    if "prisma" not in text:
        return
    hits = []
    for m in FUNC_HEADER_RE.finditer(text):
        name = m.group(1)
        brace_pos = m.end() - 1  # index of `{`
        end = find_matching_brace(text, brace_pos)
        if end < 0:
            continue
        body = text[brace_pos + 1 : end]
        if "prisma" not in body or "for" not in body and "forEach" not in body and "map(" not in body:
            continue
        for loop_m in LOOP_BLOCK_RE.finditer(body):
            loop_body = loop_m.group("loop")
            pmatch = PRISMA_LOOKUP_RE.search(loop_body)
            if pmatch:
                hits.append((name, pmatch.group(0), loop_body[:200].replace("\n", " ")))
    return hits

def main():
    files = []
    for root in ("src/lib", "src/app"):
        files.extend(Path(root).rglob("*.ts"))
    files = [f for f in files if "__tests__" not in str(f)]
    total = 0
    for f in sorted(files):
        hits = scan(f)
        if not hits:
            continue
        rel = f.relative_to(Path.cwd())
        print(f"== {rel} ==")
        for name, call, snippet in hits:
            print(f"  fn {name}() :: {call}")
            print(f"    {snippet[:160]}")
        total += len(hits)
    print(f"\nTOTAL hits: {total}")

if __name__ == "__main__":
    main()
