#!/usr/bin/env -S npx tsx
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = join(__dirname, "..");
const README = join(ROOT, "README.md");
const START = "<!-- README_METRICS_START -->";
const END = "<!-- README_METRICS_END -->";

type Metric = { label: string; value: string };

function walk(dir: string, predicate: (path: string) => boolean): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (["node_modules", ".next", ".git", "dist", "coverage"].includes(entry.name)) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full, predicate));
    else if (predicate(full)) out.push(full);
  }
  return out;
}

function countModels(): number {
  const schema = readFileSync(join(ROOT, "prisma/schema.prisma"), "utf8");
  return (schema.match(/^model\s+\w+\s+\{/gm) ?? []).length;
}

function countUseI18n(): number {
  return walk(join(ROOT, "src"), (p) => /\.[tj]sx?$/.test(p)).reduce((sum, file) => {
    const text = readFileSync(file, "utf8");
    return sum + (text.match(/\buseI18n\s*\(/g) ?? []).length;
  }, 0);
}

function srcLines(): number {
  return walk(join(ROOT, "src"), (p) => /\.[tj]sx?$/.test(p)).reduce((sum, file) => {
    return sum + readFileSync(file, "utf8").split(/\r?\n/).length;
  }, 0);
}

function metrics(): Metric[] {
  const srcApp = join(ROOT, "src/app");
  const pages = walk(srcApp, (p) => /\/page\.tsx$/.test(p)).length;
  const apiRoutes = walk(srcApp, (p) => /\/api\/.*\/route\.ts$/.test(p)).length;
  const components = walk(join(ROOT, "src/components"), (p) => /\.[tj]sx?$/.test(p) && !p.includes("/__tests__/")).length;
  const tests = walk(ROOT, (p) => /(__tests__\/.*\.(test|spec)\.[tj]sx?$)|(\.(test|spec)\.[tj]sx?$)/.test(p)).length;
  const dictionaries = walk(join(ROOT, "src/lib/i18n/dictionaries"), (p) => p.endsWith(".ts")).length;
  const catalogFiles = walk(join(ROOT, "src/lib/quick-service"), (p) => /catalog.*\.ts$/.test(p));
  const templates = catalogFiles.reduce((sum, file) => {
    const text = readFileSync(file, "utf8");
    return sum + (text.match(/slug:\s*["']/g) ?? []).length;
  }, 0);
  return [
    { label: "功能页面", value: String(pages) },
    { label: "API 路由文件", value: String(apiRoutes) },
    { label: "数据模型", value: String(countModels()) },
    { label: "UI 组件", value: String(components) },
    { label: "代码行数", value: `~${srcLines().toLocaleString("en-US")}（src 扫描）` },
    { label: "测试", value: `${tests} 文件` },
    { label: "Docker 应用模板", value: `${templates} (本地) + 社区源实时同步` },
    { label: "i18n", value: `${countUseI18n()} useI18n() 调用点，${dictionaries} 字典文件` },
  ];
}

function render(items: Metric[]): string {
  const rows = items.map((m) => `| ${m.label.padEnd(15, " ")} | ${m.value.padEnd(48, " ")} |`).join("\n");
  return `${START}\n| 指标            | 数量                                             |\n| --------------- | ------------------------------------------------ |\n${rows}\n${END}`;
}

const write = process.argv.includes("--write");
const readme = readFileSync(README, "utf8");
const block = render(metrics());
const re = new RegExp(`${START}[\\s\\S]*?${END}`);
if (!re.test(readme)) {
  throw new Error(`README metrics markers not found: ${relative(ROOT, README)}`);
}
const next = readme.replace(re, block);
if (write) {
  writeFileSync(README, next);
  console.log("README metrics updated");
} else if (next !== readme) {
  console.error("README metrics are stale. Run: npm run readme:metrics:write");
  process.exit(1);
} else {
  console.log("README metrics are current");
}
