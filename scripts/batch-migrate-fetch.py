#!/usr/bin/env python3
"""
Batch-replace bare fetch() → csrfFetch() in client components,
and alert() → toast for a better UX.
"""
import re, os, sys

DRY_RUN = "--apply" not in sys.argv

# Files to skip (server-side, already has CSRF, or streaming)
SKIP_FILES = {
    "src/lib/auth/csrf-client.ts",  # definition file
    "src/lib/http/api-client.ts",    # new api client
    "src/lib/ai/service.ts",         # server-side
    "src/lib/aria2/service.ts",      # server-side
}

# Files that use streaming fetch (keep raw fetch, just add CSRF header)
STREAMING_FILES = {
    "src/app/ai/ai-client.tsx",  # /api/ai/chat uses SSE streaming
}

BASE = "/root/firstproject"

def process_file(filepath):
    """Process a single file, return (changed, diff_summary)"""
    rel = os.path.relpath(filepath, BASE)
    if rel in SKIP_FILES:
        return False, "skipped"
    
    with open(filepath, "r") as f:
        original = f.read()
    
    content = original
    changes = []
    
    # Check if it's a "use client" file
    is_client = '"use client"' in content or "'use client'" in content
    if not is_client:
        return False, "not a client component"
    
    # Count fetch calls
    fetch_count = len(re.findall(r'\bfetch\s*\(', content))
    alert_count = len(re.findall(r'\balert\s*\(', content))
    if fetch_count == 0 and alert_count == 0:
        return False, "no fetch/alert"
    
    # Add csrfFetch import if there are fetch calls
    if fetch_count > 0:
        # Check if already imported
        if "csrfFetch" not in content and 'from "@/lib/auth/csrf-client"' not in content:
            # Find a good place to insert the import (after the last import line)
            import_lines = [i for i, line in enumerate(content.split("\n")) 
                          if line.startswith("import ")]
            if import_lines:
                lines = content.split("\n")
                last_import_idx = import_lines[-1]
                lines.insert(last_import_idx + 1, 'import { csrfFetch } from "@/lib/auth/csrf-client";')
                content = "\n".join(lines)
                changes.append(f"added csrfFetch import")
            else:
                # Add at top after "use client"
                content = content.replace(
                    '"use client";\n',
                    '"use client";\n\nimport { csrfFetch } from "@/lib/auth/csrf-client";\n',
                    1
                )
                changes.append("added csrfFetch import at top")
        
        # Replace fetch( → csrfFetch( for API calls only
        # Pattern: fetch(`/api/... or fetch("/api/... or fetch('/api/...
        content = re.sub(
            r'\bfetch\s*\(\s*([`"\']\s*/api/)',
            r'csrfFetch(\1',
            content
        )
        replaced = len(re.findall(r'csrfFetch\s*\(\s*[`"\']\s*/api/', content))
        if replaced > 0:
            changes.append(f"replaced {min(fetch_count, replaced)} fetch→csrfFetch")
    
    # Replace alert() with console.warn + add useToast where possible
    if alert_count > 0:
        # Add useToast import if not present
        if "useToast" not in content and 'from "@/components/toast-provider"' not in content:
            lines = content.split("\n")
            import_lines = [i for i, line in enumerate(lines) if line.startswith("import ")]
            if import_lines:
                last_import_idx = import_lines[-1]
                lines.insert(last_import_idx + 1, 'import { useToast } from "@/components/toast-provider";')
                content = "\n".join(lines)
                changes.append("added useToast import")
        
        # Add const { addToast } = useToast() inside the component function
        if "addToast" not in content:
            # Find the component function body start
            # Pattern: export function XXX() { or export default function XXX() { or function XXX({
            func_match = re.search(r'(export\s+(?:default\s+)?function\s+\w+\s*\([^)]*\)\s*\{)', content)
            if func_match:
                insert_pos = func_match.end()
                content = content[:insert_pos] + '\n\tconst { addToast } = useToast();' + content[insert_pos:]
                changes.append("added useToast() call")
            else:
                # Try arrow function: const XXX = () => {
                func_match = re.search(r'(export\s+(?:default\s+)?(?:const|function)\s+\w+\s*=\s*\([^)]*\)\s*=>\s*\{)', content)
                if func_match:
                    insert_pos = func_match.end()
                    content = content[:insert_pos] + '\n\tconst { addToast } = useToast();' + content[insert_pos:]
                    changes.append("added useToast() call in arrow fn")
        
        # Replace alert("xxx") → addToast("error", "xxx")
        # Pattern: alert("msg") or alert('msg')
        content = re.sub(
            r'\balert\s*\(\s*(["\'])(.*?)\1\s*\)',
            r'addToast("error", \1\2\1)',
            content
        )
        # Pattern: alert(`msg`) 
        content = re.sub(
            r'\balert\s*\(\s*`(.*?)`\s*\)',
            r'addToast("error", `\1`)',
            content
        )
        changes.append(f"replaced {alert_count} alert→toast")
    
    if content != original:
        if not DRY_RUN:
            with open(filepath, "w") as f:
                f.write(content)
        return True, ", ".join(changes)
    return False, "no changes needed"

# Get all files with fetch() calls
import subprocess
result = subprocess.run(
    ["grep", "-rl", "fetch(", "src/", "--include=*.tsx", "--include=*.ts"],
    capture_output=True, text=True, cwd=BASE
)
files = [f.strip() for f in result.stdout.strip().split("\n") if f.strip()]
files = [f for f in files if "node_modules" not in f and ".next" not in f]

print(f"Found {len(files)} files with fetch() calls")
print(f"Mode: {'APPLY' if not DRY_RUN else 'DRY RUN (--apply to actually write)'}")
print()

changed_count = 0
for f in files:
    full_path = os.path.join(BASE, f)
    changed, summary = process_file(full_path)
    status = "✅" if changed else "⏭️"
    print(f"  {status} {f}: {summary}")
    if changed:
        changed_count += 1

print(f"\nTotal: {changed_count}/{len(files)} files changed")
