import fs from 'fs/promises';
import path from 'path';

const SRC_DIR = './src/app';

// Extended token map for remaining files
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

  // Blue / Violet / Indigo -> Accent / Info
  'bg-blue-400': 'bg-[var(--accent)]',
  'bg-blue-500': 'bg-[var(--accent)]',
  'text-blue-100': 'text-[var(--accent)]',
  'text-blue-200': 'text-[var(--accent)]',
  'text-blue-300': 'text-[var(--accent)]',
  'text-blue-400': 'text-[var(--accent)]',
  'border-blue-400': 'border-[var(--accent-border)]',
  'bg-violet-400': 'bg-[var(--accent)]',
  'bg-violet-500': 'bg-[var(--accent)]',
  'text-violet-100': 'text-[var(--accent)]',
  'text-violet-200': 'text-[var(--accent)]',
  'text-violet-300': 'text-[var(--accent)]',
  'border-violet-400': 'border-[var(--accent-border)]',
  'bg-purple-400': 'bg-[var(--accent)]',
  'bg-purple-500': 'bg-[var(--accent)]',
  'text-purple-100': 'text-[var(--accent)]',
  'text-purple-200': 'text-[var(--accent)]',
  'text-purple-300': 'text-[var(--accent)]',
  'border-purple-400': 'border-[var(--accent-border)]',
  
  // Generic Slate/Gray replacements for structural UI elements
  'border-slate-300': 'border-[var(--border)]',
  'border-slate-400': 'border-[var(--border-strong)]',
  'text-slate-700': 'text-[var(--text-secondary)]',
  'text-slate-600': 'text-[var(--text-muted)]',
  'bg-slate-100': 'bg-[var(--surface-subtle)]',
  'bg-slate-50': 'bg-[var(--surface-subtle)]'
};

async function processFile(filePath) {
  let content = await fs.readFile(filePath, 'utf-8');
  let changed = false;
  
  // Custom manual replacements for specific semantic components
  if (content.includes('bg-rose-500/10 text-rose-200 border border-rose-400/20')) {
    content = content.replace(/bg-rose-500\/10 text-rose-200 border border-rose-400\/20/g, 'bg-[var(--danger-bg)] text-[var(--danger)] border-[var(--danger-border)]');
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

    { pattern: /bg-(blue|violet|purple)-(?:[456]00)\/[0-9]+/g, replacement: 'bg-[var(--accent-bg)]' },
    { pattern: /text-(blue|violet|purple)-(?:[234]00)/g, replacement: 'text-[var(--accent)]' },
    { pattern: /border-(blue|violet|purple)-(?:[456]00)\/[0-9]+/g, replacement: 'border-[var(--accent-border)]' },
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

walk(SRC_DIR).then(() => console.log('Done mapping extended semantic tokens.'));
