#!/usr/bin/env python3
"""
Fix all files after csrfFetch change: remove redundant .json() calls.

csrfFetch now auto-parses JSON, so patterns like:
  const res = await csrfFetch(...);
  const data = await res.json();
become:
  const data = await csrfFetch(...);

And patterns like:
  const res = await csrfFetch(...);
  if (res.ok) { const data = await res.json(); }
become:
  const res = await csrfFetch(...);  // throws on non-ok, no need for res.ok check
  // data is already res
"""
import re, os, sys

DRY_RUN = "--apply" not in sys.argv

def process_file(filepath):
    with open(filepath, "r", encoding="utf-8") as f:
        content = f.read()
    
    original = content
    
    # Pattern 1: const res = await csrfFetch(...); const data = await res.json();
    # → const data = await csrfFetch(...);
    # This handles both same-line and next-line .json() calls
    
    lines = content.split("\n")
    new_lines = []
    i = 0
    changes = 0
    
    # Track variable assignments from csrfFetch
    # Map: var_name → the full await csrfFetch(...) expression
    csrf_vars = {}  # var_name -> line_index
    
    while i < len(lines):
        line = lines[i]
        stripped = line.strip()
        
        # Detect: const/let/var X = await csrfFetch(...)
        m = re.match(r'^(\s*)(const|let|var)\s+(\w+)\s*=\s*await\s+csrfFetch\((.+)\)\s*;?\s*$', line)
        if m:
            indent, decl, varname, args = m.groups()
            csrf_vars[varname] = i
            
            # Check if next non-empty line is: const data = await VAR.json()
            j = i + 1
            while j < len(lines) and lines[j].strip() == "":
                j += 1
            
            if j < len(lines):
                next_line = lines[j]
                m2 = re.match(r'^(\s*)(const|let|var)\s+(\w+)\s*=\s*await\s+' + re.escape(varname) + r'\.json\(\)\s*;?\s*(?:\.catch\([^)]*\)\s*)?$', next_line)
                if m2:
                    next_indent, next_decl, next_varname = m2.group(1, 2, 3)
                    # Merge: replace both lines with single assignment
                    new_lines.append(f"{indent}{next_decl} {next_varname} = await csrfFetch({args});")
                    changes += 1
                    i = j + 1  # skip the .json() line
                    # Also remove any blank lines between them? No, keep them.
                    # Skip any blank lines we jumped over
                    for k in range(i, j):
                        pass  # already past
                    continue
                else:
                    # Check for: const data = await VAR.json().catch(() => ({}))
                    m3 = re.match(r'^(\s*)(const|let|var)\s+(\w+)\s*=\s*await\s+' + re.escape(varname) + r'\.json\(\)\.catch\([^)]*\)\s*;?\s*$', next_line)
                    if m3:
                        next_indent, next_decl, next_varname = m3.group(1, 2, 3)
                        new_lines.append(f"{indent}{next_decl} {next_varname} = await csrfFetch({args});")
                        changes += 1
                        i = j + 1
                        continue
            
            # Also check for multi-line csrfFetch (where the closing paren is on next line)
            # Just keep the line as-is for now
            new_lines.append(line)
            i += 1
            continue
        
        # Pattern 2: if (res.ok) { const data = await res.json(); } 
        # After csrfFetch auto-throws, res.ok is always true
        # But this is complex to handle generically, skip for now
        
        # Pattern 3: X.then((r) => r.json()) — promise chain style
        # This needs different handling since csrfFetch resolves to data not Response
        
        new_lines.append(line)
        i += 1
    
    content = "\n".join(new_lines)
    
    if content != original:
        if DRY_RUN:
            print(f"  Would modify: {filepath} ({changes} changes)")
        else:
            with open(filepath, "w", encoding="utf-8") as f:
                f.write(content)
            print(f"  ✅ Modified: {filepath} ({changes} changes)")
        return True
    return False

# Find all files
import subprocess
result = subprocess.run(
    ["grep", "-rl", "csrfFetch(", "src/", "--include=*.tsx"],
    capture_output=True, text=True, cwd="/root/firstproject"
)
files = [f.strip() for f in result.stdout.strip().split("\n") if f.strip()]
print(f"Found {len(files)} files with csrfFetch")

modified = 0
for f in files:
    filepath = os.path.join("/root/firstproject", f)
    if process_file(filepath):
        modified += 1

print(f"\n{'Would modify' if DRY_RUN else 'Modified'} {modified} files")
if DRY_RUN:
    print("Run with --apply to make changes")
