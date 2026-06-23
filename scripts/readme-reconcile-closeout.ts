#!/usr/bin/env -S npx tsx
/**
 * scripts/readme-reconcile-closeout.ts — TR New-G 实现 (cron 集成版)
 *
 * 设计目标: 让 cron (job 9e36e64a75ae) 在每个 TR 完成 closeout 时,
 * 自动跑一次 readme 对账, 把"代码已落地 / README 还写 ⏳"的漂移收口.
 *
 * 与 scripts/readme-reconcile.ts 区别:
 *  - readme-reconcile.ts  -- 对账 + 输出 diff (人审友好, dry-run 默认)
 *  - readme-reconcile-closeout.ts  -- cron 用: 永远真写, 失败不抛,
 *    写完自动 `git diff --stat` 显示本次 README 改了 N 行, 输出贴近 cron 日志.
 *
 * 安全护栏:
 *  - 只在 git working tree 干净时跑 (避免和未 commit 的 closeout 撞)
 *  - 只在 /opt/VControlHub 跑 (cwd guard)
 *  - README 改动走同一 git commit 是允许的 (closeout 范式里有 README 更新这步)
 *  - 失败时 stderr 输出原因, exit 0 (不阻塞主 cron flow)
 */

import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
const ROOT = "/opt/VControlHub";

function run(cmd: string): string {
  try {
    return execSync(cmd, { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  } catch (e: unknown) {
    const err = e as { stdout?: string; stderr?: string };
    return (err.stdout || "") + (err.stderr || "");
  }
}

function main() {
  if (!existsSync(ROOT + "/.git")) {
    console.error(`[skip] ${ROOT} 不是 git 仓库`);
    return;
  }

  const status = run("git status --short");
  // 允许 .hermes/ 和 .next/ dirty (cron 正常状态)
  const dirtyFiles = status
    .split("\n")
    .filter((l) => l.trim())
    .filter((l) => !l.includes(".hermes/") && !l.includes(".next/"));
  if (dirtyFiles.length > 0) {
    console.log(`[skip] working tree 不干净 (${dirtyFiles.length} 文件), 留给 closeout 自己 commit README`);
    return;
  }

  console.log("[closeout] 跑 readme-reconcile --write");
  const out = run("npx tsx scripts/readme-reconcile.ts --write 2>&1 | tail -20");
  console.log(out);

  // 统计 README 改了多少行
  const diff = run("git diff --stat README.md");
  if (diff) {
    console.log(`[closeout] README 改动: ${diff.split("\n").pop() || diff}`);
  } else {
    console.log("[closeout] README 无变化");
  }
}

main();
