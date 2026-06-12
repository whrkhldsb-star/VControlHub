# VControlHub TR-advancer 状态记录

由 `tr-advancer` cron job 自动维护。

## Schema
```ts
{
  version: number;            // 当前 1
  startedAt: string;          // ISO timestamp
  lastRunAt: string | null;   // 本 job 上次跑完时间
  lastTr: string | null;      // 本 job 上次完成的 TR 编号
  completedTrs: string[];     // 本 job 完成的 TR 列表（不含人类本轮手动完成）
  inProgressTr: string | null;
  skippedTrs: Array<{ id: string; reason: string }>;
  nextStrategy: string;       // 给下一轮 cron 的提示
  rounds: number;             // 累计完成轮次
}
```

## 配套 prompt 约束
- 一次 1 个 TR，绝不多开
- 高质量门槛：明确正收益 + 可闭环 + 可验证
- 完整 closeout：targeted test → `npm run verify` → build/deploy/smoke/log → commit/push
- 不递归创建/修改 cron
- 不空 commit
- 不动需要人类决策/外部资源/重大架构的 TR

## 频率
**每 10 分钟**。一轮 `npm run verify` ~5min + 部署/smoke/commit ~1min = ~6min，10m 留 4min 缓冲。如遇上一轮还没完（worktree dirty），新 tick 自动检测后会走只读审计 / 跳过本轮。
