import fs from 'fs/promises';
import path from 'path';

const SRC_DIR = './src';
const COLOR_CLASSES_REGEX = /(?:bg|text|border|ring|from|via|to|shadow)-(white|black|slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-\d{2,3}/g;

async function walk(dir) {
  let results = [];
  const list = await fs.readdir(dir, { withFileTypes: true });
  for (const file of list) {
    const filePath = path.join(dir, file.name);
    if (file.isDirectory()) {
      results = results.concat(await walk(filePath));
    } else if (file.name.endsWith('.tsx') || file.name.endsWith('.ts')) {
      const content = await fs.readFile(filePath, 'utf-8');
      // match all hardcoded colors, but exclude those that are inside light: or dark: modifiers if possible, or just list them all
      const matches = content.match(COLOR_CLASSES_REGEX) || [];
      if (matches.length > 0) {
        results.push({ file: filePath, count: matches.length, samples: [...new Set(matches)].slice(0, 10) });
      }
    }
  }
  return results;
}

walk(SRC_DIR).then(results => {
  console.log(`Found ${results.length} files with hardcoded colors`);
  const top15 = results.sort((a, b) => b.count - a.count).slice(0, 15);
  console.log(JSON.stringify(top15, null, 2));
});
