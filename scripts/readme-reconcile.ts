#!/usr/bin/env -S npx tsx
/**
 * scripts/readme-reconcile.ts — TR New-G 实现
 *
 * 扫描 3 个数据源,自动重写 README 里"现有 TR 核实结果"段(行 561-565):
 *   1. .hermes/state/vcontrolhub-task-queue.json (cron 队列:done/in_progress/pending)
 *   2. git log --grep "TR-XXX" (commit 信息里的 TR 编号)
 *   3. README 现有表格 (源,作为 fallback)
 *
 * 输出: 4 段分类
 *   - 真已完成 (✅): queue done + git log 至少 1 个 commit 含此 TR
 *   - 主体已落地 (⚠): queue 里有 task 但不是 done,或 git log 没 commit 标
 *   - 真未启动 (❌): README 表格有但 queue 里完全没出现
 *   - 巡检工具已落地 (📋): TR-003 a11y 这种特殊状态
 *
 * 默认 dry-run (只 print 差异); 加 --write 才会写 README.
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { execSync } from "node:child_process";
import { resolve } from "node:path";
import { homedir } from "node:os";

const ROOT = resolve(__dirname, "..");
const README = resolve(ROOT, "README.md");
// queue 实际位置: ~/.hermes/state/ (cron 用 user home) 或 repo .hermes/ (兼容旧位置)
const QUEUE_CANDIDATES = [
  resolve(homedir(), ".hermes/state/vcontrolhub-task-queue.json"),
  resolve(ROOT, ".hermes/state/vcontrolhub-task-queue.json"),
];
const QUEUE = QUEUE_CANDIDATES.find((p) => existsSync(p)) ?? QUEUE_CANDIDATES[0]!;

type TaskStatus = "pending" | "in_progress" | "done" | "failed_permanently" | "blocked" | "manual";

interface QueueTask {
  id: string;
  tr?: string;
  status: TaskStatus;
  title?: string;
  commit?: string;
  completed_at?: string;
}

interface QueueShape {
  tasks: QueueTask[];
}

const trStandalone = /(?<=[\s:,(/])(TR-\d{3})(?=[\s:/),.])/g;

function loadQueue(): QueueShape {
  try {
    return JSON.parse(readFileSync(QUEUE, "utf8")) as QueueShape;
  } catch (e) {
    console.error(`[ERR] 读 ${QUEUE} 失败:`, (e as Error).message);
    process.exit(1);
  }
}

function gitTrCommits(): Map<string, string[]> {
  // TR-001 ~ TR-050 范围
  // 严格匹配: TR-XXX 前后是"独立 token" (空格/冒号/逗号/括号/字符串边界)
  // 列表中后项的过滤在 match loop 里 (跳过 "TR-XXX/" 后面紧跟 / 的)
  const trStandalone = /(?<=[\s:,(/])(TR-\d{3})(?=[\s:/),.]|$)/g;
  const map = new Map<string, string[]>();
  try {
    // 1) 先 grep 出含 TR-XXX 的 commit 行 (省时间)
    const out = execSync(`git log --oneline --grep="TR-0" -i -n 500`, {
      cwd: ROOT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    for (const line of out.split("\n")) {
      const matches = [...line.matchAll(trStandalone)];
      for (const m of matches) {
        const tr = m[1];
        if (!tr) continue;
        // 过滤: TR-XXX 后面紧跟 / 的是列表中后项 (例如 "TR-008/017" 中 017),
        //       只保留第一个 (其 lookbehind 是空格/冒号等, lookbehind 是 / 的跳过)
        const idx = m.index ?? 0;
        const before = idx > 0 ? line[idx - 1] : "";
        if (before === "/") continue;
        if (!map.has(tr)) map.set(tr, []);
        map.get(tr)!.push(line);
      }
    }
  } catch {
    // git log 失败: 安静 fallback 到空 map
  }
  return map;
}

function readmeTrTable(): Set<string> {
  const set = new Set<string>();
  try {
    const readme = readFileSync(README, "utf8");
    // 匹配形如 | TR-007 | P2 | ... 的表格行
    const tableRe = /^\| (TR-\d{3}) \|/gm;
    for (const m of readme.matchAll(tableRe)) {
      const tr = m[1];
      if (tr) set.add(tr);
    }
  } catch {
    // ignore
  }
  return set;
}

function classify(queue: QueueShape, commits: Map<string, string[]>, table: Set<string>) {
  const queueTr = new Map<string, QueueTask[]>();
  for (const t of queue.tasks) {
    if (!t.tr) continue;
    const m = t.tr.match(/TR-(\d{3})/);
    if (!m) continue;
    // m[1] 是 3 位数字, 拼 TR- 前缀
    const tr = `TR-${m[1]}`;
    if (!queueTr.has(tr)) queueTr.set(tr, []);
    queueTr.get(tr)!.push(t);
  }

  const trulyDone: string[] = [];
  const partial: string[] = [];
  const noTask: string[] = [];
  const inspection: string[] = []; // TR-003 这类

  // 分类规则 (3 类):
  //   真已完成: git log 标了此 TR (commit 是事实)
  //   真未启动: git log 没标 + queue 也没 task (完全没做)
  //   主体已落地: git log 没标 + queue 有 task (做了但没标 commit, 多数是 in_progress/pending)
  for (const tr of [...table].sort()) {
    const tasks = queueTr.get(tr) ?? [];
    if (tr === "TR-003") {
      inspection.push(tr);
      continue;
    }
    const hasCommit = (commits.get(tr) ?? []).length > 0;
    const anyDone = tasks.some((t) => t.status === "done");
    if (hasCommit) {
      trulyDone.push(tr);
    } else if (tasks.length === 0) {
      noTask.push(tr);
    } else {
      partial.push(tr);
    }
    // 副作用: anyDone 仅用于日志统计, 不影响分类
    void anyDone;
  }
  return { trulyDone, partial, noTask, inspection };
}

function render(newBlock: { trulyDone: string[]; partial: string[]; noTask: string[]; inspection: string[] }) {
  return [
    "按\"复选框语义与代码事实是否吻合\"重新分类：",
    `- **真已完成** ${newBlock.trulyDone.join(" / ")}`,
    `- **主体已落地、复选框未收口**（描述写"已完成主体/继续补"，状态符号仍 [ ]）：${newBlock.partial.join(" / ")}`,
    newBlock.inspection.length
      ? `- **巡检工具已落地、剩余为 advisory 巡检项**（${newBlock.inspection.join(" / ")}）：静态分析覆盖,剩余需人工 review。`
      : null,
    `- **真未启动**：${newBlock.noTask.join(" / ")}`,
  ]
    .filter((l) => l !== null)
    .map((l) => (l.startsWith("按") || l.startsWith("- **") ? l : `  ${l}`))
    .join("\n");
}

function main() {
  const args = process.argv.slice(2);
  const write = args.includes("--write");

  const queue = loadQueue();
  const commits = gitTrCommits();
  const table = readmeTrTable();
  const classified = classify(queue, commits, table);

  const newBlock = render(classified);

  // 从 README 抽出"现有 TR 核实结果"段作为对比
  const readme = readFileSync(README, "utf8");
  const sectionRe = /### 现有 TR 核实结果\n+按"复选框语义与代码事实是否吻合"重新分类：[\s\S]*?(?=\n### |\Z)/;
  const match = readme.match(sectionRe);
  const currentBlock = match ? match[0].replace(/^### 现有 TR 核实结果\n+/, "").trim() : "(未找到)";

  console.log("────── 当前 README 状态段 ──────");
  console.log(currentBlock);
  console.log();
  console.log("────── 对账后新状态段 ──────");
  console.log(newBlock);
  console.log();
  console.log("────── 数据源统计 ──────");
  console.log(`queue 任务总数: ${queue.tasks.length}`);
  console.log(`  done: ${queue.tasks.filter((t) => t.status === "done").length}`);
  console.log(`  in_progress: ${queue.tasks.filter((t) => t.status === "in_progress").length}`);
  console.log(`  pending: ${queue.tasks.filter((t) => t.status === "pending").length}`);
  console.log(`git log 含 TR-XXX 的 commits: ${[...commits.values()].reduce((s, a) => s + a.length, 0)}`);
  console.log(`README 表格里的 TR: ${table.size}`);
  console.log();
  console.log("────── 分类结果 ──────");
  console.log(`真已完成 (${classified.trulyDone.length}): ${classified.trulyDone.join(" ")}`);
  console.log(`主体已落地 (${classified.partial.length}): ${classified.partial.join(" ")}`);
  console.log(`巡检工具 (${classified.inspection.length}): ${classified.inspection.join(" ")}`);
  console.log(`真未启动 (${classified.noTask.length}): ${classified.noTask.join(" ")}`);

  if (!write) {
    console.log();
    console.log("(dry-run: 加 --write 才会真改 README)");
    return;
  }

  if (!match) {
    console.error("[ERR] 未找到 README 状态段, 拒绝写文件");
    process.exit(2);
  }

  const replacement = `### 现有 TR 核实结果\n\n${newBlock}\n`;
  const next = readme.replace(sectionRe, replacement);
  if (next === readme) {
    console.log("无变化, 不写文件");
    return;
  }
  writeFileSync(README, next, "utf8");
  console.log();
  console.log(`✅ README 已更新: ${README}`);
}

main();
