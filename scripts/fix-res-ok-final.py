#!/usr/bin/env python3
"""
Phase 4: Fix all remaining res.ok / response.ok / r.ok references
after csrfFetch auto-parses JSON. Since csrfFetch throws on non-ok,
res is now parsed data, not a Response — .ok doesn't exist.
"""
import re, os, sys, subprocess

DRY_RUN = "--apply" not in sys.argv

# Map of specific fixes per file
SPECIFIC_FIXES = {
    # csv-preview: uses raw fetch() for file content (not JSON API), keep fetch but fix pattern
    "src/app/files/preview/csv-preview-client.tsx": [
        # fetch(href) returns raw Response for file content — should NOT use csrfFetch
        # Keep as fetch, the .ok check is valid for non-JSON responses
    ],
    "src/app/files/preview/markdown-preview-client.tsx": [],
    "src/app/files/preview/text-preview-client.tsx": [],
}

def process_file(filepath):
    with open(filepath, "r", encoding="utf-8") as f:
        content = f.read()
    
    original = content
    fname = os.path.relpath(filepath, "/root/firstproject")
    
    # Skip preview files that use fetch() for raw file content (not JSON API)
    # They correctly use fetch() + res.ok + res.text() pattern for non-JSON data
    if fname in SPECIFIC_FIXES:
        return False
    
    # Generic fixes:
    
    # 1. "if (res.ok) setTasks((res).tasks ?? []);" → "setTasks(res.tasks ?? []);"
    content = re.sub(
        r'if\s*\(\s*(\w+)\.ok\s*\)\s+setTasks\(\((\1)\)\.tasks\s*\?\?\s*\[\]\)\s*;?',
        r'setTasks(\2.tasks ?? []);',
        content
    )
    
    # 2. "if (res.ok) setUsers(res);" → "setUsers(res);"
    content = re.sub(
        r'if\s*\(\s*(\w+)\.ok\s*\)\s+setUsers\(\s*\1\s*\)\s*;?',
        r'setUsers(\1);',
        content
    )
    
    # 3. "if (res.ok && data.success) {" → "if (data.success) {"
    content = re.sub(
        r'if\s*\(\s*\w+\.ok\s+&&\s+',
        r'if (',
        content
    )
    
    # 4. "if (res.ok) success++;" → "success++;"
    content = re.sub(
        r'if\s*\(\s*\w+\.ok\s*\)\s+success\+\+\s*;?',
        r'success++;',
        content
    )
    
    # 5. "if (res.ok) { showToast(...); fetchImages(...); }" → just the body
    content = re.sub(
        r'if\s*\(\s*\w+\.ok\s*\)\s*\{\s*showToast\(([^)]+)\);\s*fetchImages\(([^)]+)\);\s*\}',
        r'showToast(\1); fetchImages(\2);',
        content
    )
    
    # 6. "if (!res.ok || data.error) {" → "if (data.error) {"
    content = re.sub(
        r'if\s*\(\s*!\s*\w+\.ok\s*\|\|\s*',
        r'if (',
        content
    )
    
    # 7. Remove leftover "=> ({}));" broken lines
    content = re.sub(r'^\s*=>\s*\([^)]*\)\)\s*;?\s*$', '', content, flags=re.MULTILINE)
    
    # 8. Any remaining "if (res.ok)" single-line → remove if wrapper
    content = re.sub(
        r'if\s*\(\s*(\w+)\.ok\s*\)\s*',
        r'',
        content
    )
    
    # 9. Any remaining "if (!res.ok) throw new Error(...)" → remove (csrfFetch throws)
    content = re.sub(
        r'if\s*\(!\s*\w+\.ok\s*\)\s*throw\s+new\s+Error\([^)]*\)\s*;?\n?',
        '',
        content
    )
    
    # 10. "if (!res.ok) {" blocks → remove (csrfFetch throws, so we never reach here)
    # Find and remove if (!VAR.ok) { ... } blocks
    lines = content.split('\n')
    new_lines = []
    i = 0
    while i < len(lines):
        line = lines[i]
        m = re.match(r'^(\s*)if\s*\(!\s*(\w+)\.ok\s*\)\s*\{\s*$', line)
        if m:
            # Find matching closing brace and skip entire block
            depth = 1
            j = i + 1
            while j < len(lines) and depth > 0:
                for ch in lines[j]:
                    if ch == '{': depth += 1
                    elif ch == '}': depth -= 1
                j += 1
            i = j
            continue
        new_lines.append(line)
        i += 1
    content = '\n'.join(new_lines)
    
    if content != original:
        if DRY_RUN:
            print(f"  Would modify: {filepath}")
        else:
            with open(filepath, "w", encoding="utf-8") as f:
                f.write(content)
            print(f"  ✅ Modified: {filepath}")
        return True
    return False

result = subprocess.run(
    ["grep", "-rl", "\.ok\\b", "src/", "--include=*.tsx"],
    capture_output=True, text=True, cwd="/root/firstproject"
)
files = [f.strip() for f in result.stdout.strip().split("\n") if f.strip() and not f.strip().endswith("node_modules")]
print(f"Found {len(files)} files with .ok references")

modified = 0
for f in files:
    filepath = os.path.join("/root/firstproject", f)
    if os.path.exists(filepath) and process_file(filepath):
        modified += 1

print(f"\n{'Would modify' if DRY_RUN else 'Modified'} {modified} files")
