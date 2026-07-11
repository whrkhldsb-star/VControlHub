import fs from 'fs/promises';
import path from 'path';

// Common mapping from tailwind hardcoded classes to design tokens
const tokenMap = {
  // Emerald / Green -> Success
  'bg-emerald-400': 'bg-[var(--success)]',
  'bg-emerald-500': 'bg-[var(--success)]',
  'bg-emerald-50': 'bg-[var(--success-bg)]',
  'bg-emerald-100': 'bg-[var(--success-bg)]',
  'text-emerald-100': 'text-[var(--success)]',
  'text-emerald-200': 'text-[var(--success)]',
  'text-emerald-300': 'text-[var(--success)]',
  'text-emerald-400': 'text-[var(--success)]',
  'text-emerald-500': 'text-[var(--success)]',
  'border-emerald-400': 'border-[var(--success-border)]',
  'border-emerald-500': 'border-[var(--success-border)]',
  'border-emerald-700': 'border-[var(--success-border)]',
  
  // Rose / Red -> Danger
  'bg-rose-400': 'bg-[var(--danger)]',
  'bg-rose-500': 'bg-[var(--danger)]',
  'bg-rose-50': 'bg-[var(--danger-bg)]',
  'bg-rose-100': 'bg-[var(--danger-bg)]',
  'text-rose-100': 'text-[var(--danger)]',
  'text-rose-200': 'text-[var(--danger)]',
  'text-rose-300': 'text-[var(--danger)]',
  'text-rose-400': 'text-[var(--danger)]',
  'text-rose-500': 'text-[var(--danger)]',
  'border-rose-400': 'border-[var(--danger-border)]',
  'border-rose-500': 'border-[var(--danger-border)]',
  'border-rose-700': 'border-[var(--danger-border)]',

  // Amber / Yellow -> Warning
  'bg-amber-400': 'bg-[var(--warning)]',
  'bg-amber-500': 'bg-[var(--warning)]',
  'bg-amber-50': 'bg-[var(--warning-bg)]',
  'bg-amber-100': 'bg-[var(--warning-bg)]',
  'text-amber-100': 'text-[var(--warning)]',
  'text-amber-200': 'text-[var(--warning)]',
  'text-amber-300': 'text-[var(--warning)]',
  'text-amber-400': 'text-[var(--warning)]',
  'text-amber-500': 'text-[var(--warning)]',
  'border-amber-400': 'border-[var(--warning-border)]',
  'border-amber-500': 'border-[var(--warning-border)]',
  'border-amber-700': 'border-[var(--warning-border)]',

  // Sky / Blue -> Info / Accent
  'bg-sky-400': 'bg-[var(--accent)]',
  'bg-sky-500': 'bg-[var(--accent)]',
  'bg-sky-50': 'bg-[var(--accent-bg)]',
  'bg-sky-100': 'bg-[var(--accent-bg)]',
  'text-sky-100': 'text-[var(--accent)]',
  'text-sky-200': 'text-[var(--accent)]',
  'text-sky-300': 'text-[var(--accent)]',
  'text-sky-400': 'text-[var(--accent)]',
  'text-sky-500': 'text-[var(--accent)]',
  'border-sky-400': 'border-[var(--accent-border)]',
  'border-sky-500': 'border-[var(--accent-border)]',
  'border-sky-700': 'border-[var(--accent-border)]',
  
  // Slate / Gray -> Surface / Text Muted
  'bg-slate-400': 'bg-[var(--surface-elevated)]',
  'bg-slate-500': 'bg-[var(--surface-elevated)]',
  'bg-slate-800': 'bg-[var(--surface-subtle)]',
  'bg-slate-50': 'bg-[var(--surface-subtle)]',
  'bg-slate-100': 'bg-[var(--surface-subtle)]',
  'text-slate-900': 'text-[var(--text-primary)]',
  'text-slate-700': 'text-[var(--text-secondary)]',
  'text-slate-600': 'text-[var(--text-secondary)]',
  'text-slate-500': 'text-[var(--text-muted)]',
  'text-slate-400': 'text-[var(--text-muted)]',
  'border-slate-200': 'border-[var(--border)]',
  'border-slate-300': 'border-[var(--border)]',
  'border-slate-400': 'border-[var(--border-strong)]',
};

async function processFile(filePath) {
  let content = await fs.readFile(filePath, 'utf-8');
  let changed = false;
  
  // Custom manual replacements for specific semantic components
  // Replaces inline badge style arrays with actual semantic tokens if possible
  if (content.includes('border-emerald-400/30 bg-emerald-400/10')) {
    content = content.replace(/border-emerald-400\/30 bg-emerald-400\/10 text-emerald-300/g, 'border-[var(--success-border)] bg-[var(--success-bg)] text-[var(--success)]');
    changed = true;
  }
  
  for (const [tailwind, token] of Object.entries(tokenMap)) {
    // Only replace whole words (not partial matches like `text-emerald-400/50` just yet if we can avoid it easily)
    // We use a regex to ensure word boundaries but allow trailing transparency /XX
    const regex = new RegExp(`\\b${tailwind}(?:\\/(?:10|20|30|40|50|60|70|80|90|100|[0-9]+))?\\b`, 'g');
    if (regex.test(content)) {
      content = content.replace(regex, token);
      changed = true;
    }
  }

  // Handle remaining transparency syntax that might have been missed by the explicit map
  // E.g. bg-emerald-500/10 -> bg-[var(--success-bg)]
  const fallbackRegexes = [
    { pattern: /bg-(emerald|green)-(?:[456]00)\/[0-9]+/g, replacement: 'bg-[var(--success-bg)]' },
    { pattern: /text-(emerald|green)-(?:[234]00)/g, replacement: 'text-[var(--success)]' },
    { pattern: /border-(emerald|green)-(?:[456]00)\/[0-9]+/g, replacement: 'border-[var(--success-border)]' },
    
    { pattern: /bg-(rose|red)-(?:[456]00)\/[0-9]+/g, replacement: 'bg-[var(--danger-bg)]' },
    { pattern: /text-(rose|red)-(?:[234]00)/g, replacement: 'text-[var(--danger)]' },
    { pattern: /border-(rose|red)-(?:[456]00)\/[0-9]+/g, replacement: 'border-[var(--danger-border)]' },
    
    { pattern: /bg-(amber|yellow|orange)-(?:[456]00)\/[0-9]+/g, replacement: 'bg-[var(--warning-bg)]' },
    { pattern: /text-(amber|yellow|orange)-(?:[234]00)/g, replacement: 'text-[var(--warning)]' },
    { pattern: /border-(amber|yellow|orange)-(?:[456]00)\/[0-9]+/g, replacement: 'border-[var(--warning-border)]' },
  ];

  for (const { pattern, replacement } of fallbackRegexes) {
    if (pattern.test(content)) {
      content = content.replace(pattern, replacement);
      changed = true;
    }
  }

  // Remove generic `light:` and `dark:` prefixed utility colors that conflict with automatic variables
  content = content.replace(/light:(bg|text|border|ring|shadow)-[a-z]+-[0-9]+(?:\/[0-9]+)?/g, '');
  content = content.replace(/dark:(bg|text|border|ring|shadow)-[a-z]+-[0-9]+(?:\/[0-9]+)?/g, '');
  // Clean up double spaces caused by removing classes
  content = content.replace(/\s{2,}/g, ' ').replace(/ "\}/g, '"}').replace(/ >/g, '>');

  if (changed) {
    await fs.writeFile(filePath, content, 'utf-8');
    console.log(`Updated ${filePath}`);
  }
}

async function walk(dir) {
  const list = await fs.readdir(dir, { withFileTypes: true });
  for (const file of list) {
    const filePath = path.join(dir, file.name);
    if (file.isDirectory()) {
      await walk(filePath);
    } else if (file.name.endsWith('.tsx') || file.name.endsWith('.ts')) {
      await processFile(filePath);
    }
  }
}

// Target main component directories
Promise.all([
  walk('./src/app/servers'),
  walk('./src/app/media'),
  walk('./src/app/docker'),
  walk('./src/components'),
  walk('./src/app/health'),
  walk('./src/app/settings'),
]).then(() => console.log('Done mapping semantic tokens.'));
