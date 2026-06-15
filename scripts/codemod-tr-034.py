#!/usr/bin/env python3
"""
TR-034 R2 codemod (dry-run by default): replace
    return NextResponse.json({ error: "..." }, { status: N });
    return NextResponse.json({ error: "x", details: {...} }, { status: N });
with
    throw new XxxError("...");
    throw new XxxError("x", details);
or, when no `withApiRoute` is in scope (login + media-stream/share + dashboard/analytics),
    return apiError({ code: "...", message: "...", status: N });
    return apiError({ code: "...", message: "...", status: N, details: ... });

Run:
    python3 scripts/codemod-tr-034.py --dry-run         # show plan
    python3 scripts/codemod-tr-034.py --apply          # edit files in place
    python3 scripts/codemod-tr-034.py --apply --limit 5 # cap edits per run
"""
import re
import sys
import json
import argparse
from pathlib import Path

ROOT = Path("/opt/VControlHub")
SRC = ROOT / "src" / "app" / "api"

# status → (TS error class, code)
STATUS_MAP_THROW = {
    400: ("ValidationError", "VALIDATION_FAILED"),
    401: ("AuthError", "AUTH_REQUIRED"),
    403: ("ForbiddenError", "FORBIDDEN"),
    404: ("NotFoundError", "NOT_FOUND"),
    409: ("ConflictError", "CONFLICT"),
    413: ("BusinessError", "REQUEST_ENTITY_TOO_LARGE"),
    415: ("BusinessError", "UNSUPPORTED_MEDIA_TYPE"),
    422: ("BusinessError", "BUSINESS_RULE_FAILED"),
    429: ("RateLimitError", "RATE_LIMITED"),
    500: ("AppError", "INTERNAL_ERROR"),
    502: ("AppError", "EXTERNAL_SERVICE_ERROR"),
    503: ("AppError", "EXTERNAL_SERVICE_ERROR"),
}

# Match patterns (in order of specificity):
# 1. {error: <expr>, details: <expr>} { status: N }
# 2. {error: <expr>, issues: <expr>} { status: N }
# 3. {error: <expr>} { status: N }
#
# The optional `return ` prefix is captured so we can drop it when emitting
# a `throw` (AppError subclasses are thrown, not returned).
PATTERN_DETAILS = re.compile(
    r'(?P<prefix>return\s+)?NextResponse\.json\(\s*\{\s*error\s*:\s*(?P<msg>[^,}]+?)\s*,\s*details\s*:\s*(?P<details>[^}]+?)\s*\}\s*,\s*\{\s*status\s*:\s*(?P<status>\d+)\s*\}\s*\)',
    re.DOTALL,
)
PATTERN_ISSUES = re.compile(
    r'(?P<prefix>return\s+)?NextResponse\.json\(\s*\{\s*error\s*:\s*(?P<msg>[^,}]+?)\s*,\s*issues\s*:\s*(?P<details>[^}]+?)\s*\}\s*,\s*\{\s*status\s*:\s*(?P<status>\d+)\s*\}\s*\)',
    re.DOTALL,
)
PATTERN_PLAIN = re.compile(
    r'(?P<prefix>return\s+)?NextResponse\.json\(\s*\{\s*error\s*:\s*(?P<msg>[^,}]+?)\s*\}\s*,\s*\{\s*status\s*:\s*(?P<status>\d+)\s*\}\s*\)',
    re.DOTALL,
)

def make_throw(err_class: str, msg: str, details: str | None) -> str:
    if err_class == "AppError":
        if details:
            return f'throw new AppError({{ code: "INTERNAL_ERROR", message: {msg}, status: 500, details: {details} }})'
        return f'throw new AppError({{ code: "INTERNAL_ERROR", message: {msg}, status: 500 }})'
    if details:
        return f'throw new {err_class}({msg}, {details})'
    return f'throw new {err_class}({msg})'

def make_api_error(code: str, msg: str, status: int, details: str | None) -> str:
    parts = [f'code: "{code}"', f'message: {msg}', f'status: {status}']
    if details:
        parts.append(f'details: {details}')
    return f'return apiError({{ {", ".join(parts)} }})'

def find_imports(text: str) -> set[str]:
    """Find every `import { X } from "@/lib/errors"` and return the imported names."""
    names: set[str] = set()
    for m in re.finditer(r'import\s*\{([^}]+)\}\s*from\s*["\']@/lib/errors["\']', text):
        for n in m.group(1).split(","):
            n = n.strip()
            if n:
                names.add(n)
    return names

def find_api_error_imports(text: str) -> set[str]:
    """Find every `import { X } from "@/lib/http/api-error"` and return names."""
    names: set[str] = set()
    for m in re.finditer(r'import\s*\{([^}]+)\}\s*from\s*["\']@/lib/http/api-error["\']', text):
        for n in m.group(1).split(","):
            n = n.strip()
            if n:
                names.add(n)
    return names

def has_with_api_route(text: str) -> bool:
    return "withApiRoute" in text

def process_file(path: Path, apply: bool, use_throw: bool) -> list[dict]:
    text = path.read_text(encoding="utf-8")
    orig = text
    changes: list[dict] = []
    needs_imports: set[str] = set()

    # Try patterns in order.
    # Iterate matches from the END of the file backwards so that earlier
    # replacements don't shift the byte offsets of later ones.
    all_matches: list[tuple[re.Match, str | None]] = []
    for pattern, has_details in [
        (PATTERN_ISSUES, "issues"),
        (PATTERN_DETAILS, "details"),
        (PATTERN_PLAIN, None),
    ]:
        for m in pattern.finditer(text):
            all_matches.append((m, has_details))
    # Sort by start position descending so we replace from the end first.
    all_matches.sort(key=lambda pair: pair[0].start(), reverse=True)

    for m, has_details in all_matches:
        msg = m.group("msg").strip()
        status = int(m.group("status"))
        details_group = m.group("details").strip() if has_details else None

        err_class, code = STATUS_MAP_THROW.get(status, ("BusinessError", "BUSINESS_RULE_FAILED"))
        if use_throw:
            replacement = make_throw(err_class, msg, details_group)
            needs_imports.add(err_class if err_class != "AppError" else "AppError")
        else:
            replacement = make_api_error(code, msg, status, details_group)
            needs_imports.add("apiError")

        changes.append({
            "file": str(path.relative_to(ROOT)),
            "line": text[:m.start()].count("\n") + 1,
            "status": status,
            "err_class": err_class if use_throw else None,
            "code": code,
            "msg_preview": msg[:60],
            "details": "yes" if has_details else "no",
        })

        if apply:
            text = text[:m.start()] + replacement + text[m.end():]

    if not changes or not apply:
        return changes

    # Inject imports if missing
    existing_errors = find_imports(text)
    existing_api_err = find_api_error_imports(text)

    # Errors-class members go into `@/lib/errors`; `apiError` goes into
    # `@/lib/http/api-error`. Split the requested set.
    needs_errors = {n for n in needs_imports if n != "apiError"}
    needs_api_error = "apiError" in needs_imports and "apiError" not in existing_api_err

    missing_errors = needs_errors - existing_errors
    if missing_errors:
        new_names = sorted(existing_errors | missing_errors)
        new_line = f'import {{ {", ".join(new_names)} }} from "@/lib/errors";'

        m = re.search(r'import\s*\{[^}]+\}\s*from\s*["\']@/lib/errors["\'];?', text)
        if m:
            text = text[:m.start()] + new_line + text[m.end():]
        else:
            # Insert after the last `import ... from "..."` line
            last_import = list(re.finditer(r'^import .*?;\s*$', text, re.MULTILINE))
            if last_import:
                ins_at = last_import[-1].end()
                text = text[:ins_at] + "\n" + new_line + text[ins_at:]
            else:
                # No imports at all — prepend
                text = new_line + "\n\n" + text

    if needs_api_error:
        m = re.search(r'import\s*\{([^}]+)\}\s*from\s*["\']@/lib/http/api-error["\']', text)
        if m:
            current = {n.strip() for n in m.group(1).split(",") if n.strip()}
            if "apiError" not in current:
                current.add("apiError")
                new_line = f'import {{ {", ".join(sorted(current))} }} from "@/lib/http/api-error";'
                text = text[:m.start()] + new_line + text[m.end():]
        else:
            # Insert after the last `import ... from "..."` line, or after the
            # lib/errors import if one was just added above, or prepend if no
            # imports exist at all.
            m = re.search(r'import\s*\{[^}]+\}\s*from\s*["\']@/lib/errors["\'];?', text)
            if m:
                ins_at = m.end()
            else:
                last_import = list(re.finditer(r'^import .*?;\s*$', text, re.MULTILINE))
                if last_import:
                    ins_at = last_import[-1].end()
                else:
                    ins_at = 0
            line = '\nimport { apiError } from "@/lib/http/api-error";'
            if ins_at == 0:
                text = line.lstrip("\n") + "\n\n" + text
            else:
                text = text[:ins_at] + line + text[ins_at:]

    if text != orig:
        path.write_text(text, encoding="utf-8")
    return changes

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--apply", action="store_true", help="Edit files in place")
    ap.add_argument("--dry-run", action="store_true", help="Show plan, do not edit")
    ap.add_argument("--limit", type=int, default=0, help="Cap files edited (0=all)")
    args = ap.parse_args()

    if not args.apply and not args.dry_run:
        args.dry_run = True

    all_changes: list[dict] = []
    files_edited = 0

    for path in sorted(SRC.rglob("route.ts")):
        text = path.read_text(encoding="utf-8")
        # Skip test files
        if "__tests__" in str(path):
            continue
        # Skip snippets: dynamic `status` based on message content (anti-pattern
        # preserved for now — out of R2 scope).
        if path.name == "route.ts" and "snippets" in str(path):
            continue
        if "NextResponse.json({ error" not in text and "NextResponse.json({error" not in text:
            continue

        use_throw = has_with_api_route(text)
        changes = process_file(path, apply=args.apply, use_throw=use_throw)
        if changes:
            files_edited += 1
            all_changes.extend(changes)
            if args.limit and files_edited >= args.limit:
                break

    if args.dry_run:
        by_file: dict[str, list[dict]] = {}
        for c in all_changes:
            by_file.setdefault(c["file"], []).append(c)
        print(json.dumps({
            "mode": "dry-run",
            "files_to_edit": len(by_file),
            "total_replacements": len(all_changes),
            "by_file": by_file,
        }, indent=2, ensure_ascii=False))
    else:
        print(json.dumps({
            "mode": "apply",
            "files_edited": files_edited,
            "total_replacements": len(all_changes),
        }, indent=2, ensure_ascii=False))

if __name__ == "__main__":
    main()
