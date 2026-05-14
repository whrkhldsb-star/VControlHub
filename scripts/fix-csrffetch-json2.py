#!/usr/bin/env python3
"""
Phase 2: Fix all remaining .json() calls after csrfFetch.
Since csrfFetch now auto-parses JSON and throws on error:
- Remove `const data = await VAR.json()` lines where VAR was assigned from csrfFetch
- Remove `if (VAR.ok)` checks since csrfFetch throws on non-ok
- Remove `.then(r => r.json())` patterns
"""
import re, os, sys, subprocess

DRY_RUN = "--apply" not in sys.argv

def process_file(filepath):
    with open(filepath, "r", encoding="utf-8") as f:
        content = f.read()
    
    original = content
    changes = 0
    
    # Find all variable names assigned from csrfFetch
    # Pattern: const/let/var VARNAME = await csrfFetch(...)
    csrf_var_pattern = re.compile(
        r'(?:const|let|var)\s+(\w+)\s*=\s*await\s+csrfFetch\('
    )
    csrf_vars = set(csrf_var_pattern.findall(content))
    
    # Also check for: const res = await csrfFetch(...) where res is used with .json()
    # We need to replace:
    #   const res = await csrfFetch("/api/foo");
    #   const data = await res.json();
    # with:
    #   const data = await csrfFetch("/api/foo");
    
    for varname in csrf_vars:
        # Pattern: const res = await csrfFetch("/api/foo");  → keep csrfFetch but rename var
        
        # Find the csrfFetch assignment line and extract the full expression
        assign_pattern = re.compile(
            rf'(\s*)(const|let|var)\s+{re.escape(varname)}\s*=\s*(await\s+csrfFetch\([^;]+\);?)',
            re.MULTILINE
        )
        
        for match in assign_pattern.finditer(content):
            indent = match.group(1)
            decl = match.group(2)
            fetch_expr = match.group(3)
            
            # Now find: const/let/var SOMENAME = await VARNAME.json()
            json_pattern = re.compile(
                rf'(\s*)(const|let|var)\s+(\w+)\s*=\s*await\s+{re.escape(varname)}\.json\(\)\s*(?:\.catch\([^)]*\))?\s*;?\s*'
            )
            
            json_match = json_pattern.search(content, match.end())
            if json_match:
                json_indent = json_match.group(1)
                json_decl = json_match.group(2)
                json_varname = json_match.group(3)
                
                # Replace: remove the original csrfFetch assignment, replace .json() assignment with direct csrfFetch
                # Replace the .json() line with: const json_varname = fetch_expr
                new_json_line = f"{json_indent}{json_decl} {json_varname} = {fetch_expr}"
                
                # Remove the original assignment line
                original_line = match.group(0)
                content = content.replace(original_line, f"{indent}// {varname} removed — csrfFetch auto-parses JSON")
                
                # Replace the .json() line
                content = content.replace(json_match.group(0), new_json_line + "\n")
                changes += 2
        
        # Pattern: if (VAR.ok) { ... await VAR.json() ... }
        # Replace `if (res.ok)` blocks where res was from csrfFetch
        ok_pattern = re.compile(
            rf'if\s*\(\s*{re.escape(varname)}\.ok\s*\)\s*\{{',
        )
        # This is too complex for regex; skip for now
        
        # Pattern: VAR.json() inline — e.g. `setUsers(await res.json())`
        inline_json = re.compile(
            rf'await\s+{re.escape(varname)}\.json\(\)'
        )
        # Remove the .json() call since varname already has parsed data
        # But we need to handle the case where the var was assigned from csrfFetch
        # and we already replaced the assignment... 
        # Actually, if we renamed the variable, this should work automatically
        
    # Pattern: .then((r) => r.json()) — used in ai-client.tsx for promise chains
    content = re.sub(
        r'\.then\(\s*\(\s*r\s*\)\s*=>\s*r\.json\(\)\s*\)',
        '',  # remove entirely — csrfFetch already returns parsed data
        content
    )
    
    # Pattern: const data = await r.json(); where r was from csrfFetch but we may have missed it
    # Generic cleanup: any remaining "await VAR.json()" where VAR came from csrfFetch
    for varname in csrf_vars:
        # Simple inline replacement: await VAR.json() → VAR
        content = re.sub(
            rf'await\s+{re.escape(varname)}\.json\(\)',
            varname,
            content
        )
        # Also handle: await VAR.json().catch(() => ({}))
        content = re.sub(
            rf'await\s+{re.escape(varname)}\.json\(\)\.catch\([^)]*\)',
            varname,
            content
        )
    
    # Clean up comment lines we added
    content = re.sub(r'\s*//\s+\w+\s+removed — csrfFetch auto-parses JSON\n', '\n', content)
    
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
