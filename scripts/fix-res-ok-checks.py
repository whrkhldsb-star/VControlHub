#!/usr/bin/env python3
"""
Phase 3: Clean up res.ok/response.ok checks after csrfFetch auto-throws.
Since csrfFetch throws on non-ok responses, these checks are redundant.

Patterns to fix:
1. if (res.ok) { ... } → just { ... } (remove the if)
2. if (!res.ok) throw new Error(...) → remove entirely (csrfFetch already throws)
3. if (!res.ok) { handleError } → remove (csrfFetch already throws, use catch instead)
4. res.ok inline checks → remove
"""
import re, os, sys, subprocess

DRY_RUN = "--apply" not in sys.argv

def process_file(filepath):
    with open(filepath, "r", encoding="utf-8") as f:
        content = f.read()
    
    original = content
    changes = 0
    
    lines = content.split("\n")
    new_lines = []
    i = 0
    
    while i < len(lines):
        line = lines[i]
        stripped = line.strip()
        
        # Pattern: if (res.ok) { ... } — single-line check, just keep the body
        # Pattern: if (!res.ok) throw new Error(...) — remove entirely
        # Pattern: if (!res.ok) { error handling } — remove entirely
        
        m_ok = re.match(r'^(\s*)if\s*\(\s*(\w+)\.ok\s*\)\s*\{\s*$', line)
        m_not_ok_throw = re.match(r'^(\s*)if\s*\(!\s*(\w+)\.ok\s*\)\s*throw\s+new\s+Error\([^)]*\)\s*;?\s*$', line)
        m_not_ok_brace = re.match(r'^(\s*)if\s*\(!\s*(\w+)\.ok\s*\)\s*\{\s*$', line)
        
        # Inline patterns
        m_inline_ok = re.match(r'^(\s*.*?)if\s*\(\s*(\w+)\.ok\s*\)\s*(.*?)$', line)
        m_inline_not_ok = re.match(r'^(\s*.*?)if\s*\(!\s*(\w+)\.ok\s*\)\s*(.*?)$', line)
        
        if m_not_ok_throw:
            # if (!res.ok) throw new Error(...) → remove entirely
            changes += 1
            i += 1
            continue
        
        elif m_not_ok_brace:
            # if (!res.ok) { ... } → remove the if block entirely
            # Find matching closing brace
            indent = m_not_ok_brace.group(1)
            depth = 1
            j = i + 1
            while j < len(lines) and depth > 0:
                for ch in lines[j]:
                    if ch == "{": depth += 1
                    elif ch == "}": depth -= 1
                j += 1
            changes += 1
            i = j  # skip the entire if block
            continue
        
        elif m_ok:
            # if (res.ok) { ... } → keep just the body, remove if and braces
            indent = m_ok.group(1)
            body_lines = []
            depth = 1
            j = i + 1
            while j < len(lines) and depth > 0:
                for ch in lines[j]:
                    if ch == "{": depth += 1
                    elif ch == "}": depth -= 1
                if depth > 0:
                    # Remove one level of indentation
                    body_line = lines[j]
                    if body_line.startswith(indent + "\t"):
                        body_line = body_line[len(indent) + 1:]
                    elif body_line.startswith(indent + "  "):
                        body_line = body_line[len(indent) + 2:]
                    body_lines.append(body_line)
                j += 1
            new_lines.extend(body_lines)
            changes += 1
            i = j
            continue
        
        elif m_inline_ok and not stripped.startswith("if"):
            # inline: if (res.ok) doSomething() → doSomething()
            before = m_inline_ok.group(1)
            varname = m_inline_ok.group(2)
            after = m_inline_ok.group(3)
            new_lines.append(f"{before}{after}")
            changes += 1
            i += 1
            continue
        
        elif m_inline_not_ok and not stripped.startswith("if"):
            # inline: if (!res.ok) handleError → remove (csrfFetch throws)
            changes += 1
            i += 1
            continue
        
        # Pattern: res.ok in ternary or conditional → always true
        # Just keep the "true" branch
        line = re.sub(r'(\w+)\.ok\s*\?\s*', '', line)  # res.ok ? X : Y → X : Y... complex
        
        new_lines.append(line)
        i += 1
    
    content = "\n".join(new_lines)
    
    # Also clean up: res.status references (now res is data, not Response)
    # Remove lines like: throw new Error(`HTTP ${res.status}`)
    content = re.sub(r'throw\s+new\s+Error\(`HTTP\s+\$\{res\.status\}`\)\s*;?\n?', '', content)
    
    if content != original:
        if DRY_RUN:
            print(f"  Would modify: {filepath} ({changes} changes)")
        else:
            with open(filepath, "w", encoding="utf-8") as f:
                f.write(content)
            print(f"  ✅ Modified: {filepath} ({changes} changes)")
        return True
    return False

result = subprocess.run(
    ["grep", "-rl", "csrfFetch(", "src/", "--include=*.tsx"],
    capture_output=True, text=True, cwd="/root/firstproject"
)
files = [f.strip() for f in result.stdout.strip().split("\n") if f.strip()]
print(f"Found {len(files)} files")

modified = 0
for f in files:
    filepath = os.path.join("/root/firstproject", f)
    if process_file(filepath):
        modified += 1

print(f"\n{'Would modify' if DRY_RUN else 'Modified'} {modified} files")
