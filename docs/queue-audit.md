# VControlHub Cron Queue Audit

Generated: 2026-06-16T11:27:11.907Z
Source: `/root/.hermes/state/vcontrolhub-task-queue.json`

## Summary

| Metric | Value |
| --- | --- |
| Total tasks | 58 |
| done | 49 |
| pending | 6 |
| in_progress | 0 |
| blocked | 2 |
| failed_permanently | 1 |
| Drift count | 19 |

## Top-level checks

| Check | Declared | Actual | OK |
| --- | --- | --- | --- |
| done_count | 49 | 49 | ✅ |
| total | 58 | 58 | ✅ |

## Drifts

| code | severity | task | commit | message |
| --- | --- | --- | --- | --- |
| `orphan-pending-manual_only` | info | M01 | — | task M01 is pending + manual_only; cron ticks will skip this (correct, soft reminder only) |
| `orphan-pending-manual_only` | info | M03 | — | task M03 is pending + manual_only; cron ticks will skip this (correct, soft reminder only) |
| `orphan-pending-manual_only` | info | M04 | — | task M04 is pending + manual_only; cron ticks will skip this (correct, soft reminder only) |
| `orphan-pending-manual_only` | info | M05 | — | task M05 is pending + manual_only; cron ticks will skip this (correct, soft reminder only) |
| `orphan-pending-manual_only` | info | E01 | — | task E01 is pending + manual_only; cron ticks will skip this (correct, soft reminder only) |
| `orphan-pending-manual_only` | info | E02 | — | task E02 is pending + manual_only; cron ticks will skip this (correct, soft reminder only) |
| `txx-id-sequence-gap` | info | — | — | T13 not present in queue (sequence gap; soft informational) |
| `txx-id-sequence-gap` | info | — | — | T14 not present in queue (sequence gap; soft informational) |
| `txx-id-sequence-gap` | info | — | — | T15 not present in queue (sequence gap; soft informational) |
| `txx-id-sequence-gap` | info | — | — | T20 not present in queue (sequence gap; soft informational) |
| `txx-id-sequence-gap` | info | — | — | T21 not present in queue (sequence gap; soft informational) |
| `txx-id-sequence-gap` | info | — | — | T22 not present in queue (sequence gap; soft informational) |
| `txx-id-sequence-gap` | info | — | — | T23 not present in queue (sequence gap; soft informational) |
| `txx-id-sequence-gap` | info | — | — | T24 not present in queue (sequence gap; soft informational) |
| `txx-id-sequence-gap` | info | — | — | T25 not present in queue (sequence gap; soft informational) |
| `txx-id-sequence-gap` | info | — | — | T26 not present in queue (sequence gap; soft informational) |
| `txx-id-sequence-gap` | info | — | — | T27 not present in queue (sequence gap; soft informational) |
| `txx-id-sequence-gap` | info | — | — | T28 not present in queue (sequence gap; soft informational) |
| `txx-id-sequence-gap` | info | — | — | T29 not present in queue (sequence gap; soft informational) |

## Drifts by code

| code | count |
| --- | --- |
| `txx-id-sequence-gap` | 13 |
| `orphan-pending-manual_only` | 6 |

## Recent commits (last 10 of 50 sampled)

| hash | subject |
| --- | --- |
| `df5f378` | docs(readme): E05 TR-005 T34b.1 done + T34b.2 不可行 (跟 queue 同步) |
| `d6837de` | feat(scripts): E04 queue-audit — cron 任务队列自检 tooling (queue + git log 15 类 drift 检测, 26 个新测, scripts/ + docs/ 不需要 deploy) |
| `bedf1a2` | i18n R10F.2 (TR-054): 接 traffic 35 key (eyebrow/title/desc/refresh/autoRefresh×3/error/card×3/loading/iface×2/lastUpdated/rxRate/txRate/rxTotal/txTotal/noIface/th×5/remoteSampling/noRemote/badge×3/rxShort/txShort/noPrimaryIface/health×4) + formatStorageHealthStatus 改 fn 接受 t |
| `6b972d1` | i18n R10F.1 (TR-054): 接 alert-rules 80 key (eyebrow/title/desc/empty/error×4/toast×3/condition×4/metric×4/operator×5/channel×3/badge×3/lastTriggered/action×6/delete×5/createForm×34) + metricLabel/operatorLabel/channelLabel/deliveryStatusLabel 4 fn |
| `7d5a730` | refactor(storage): TR-005 T34b.1 listFileEntries/listDeletedFileEntries 加 cursor/分页参数 (take/skip/cursor 可选, 默认行为不变) + 3 个新测 |
| `ca744f0` | fix(dashboard): 修 4 列 grid 错位 — Header/StatsSection 移出 grid 外,grid 改 2 列,避免 StatsSection 跟 ServerHero 抢 server-status id |
| `479e9c3` | docs(readme): TR-037 R9 (T38e) command/backup 域收口 + 100% 覆盖 (5 域全闭环) |
| `b7590cb` | refactor(command/backup): TR-037 R9 (T38e) command 域 + 零散 1 路由 zod 迁移 |
| `26e1fc4` | docs(readme): TR-037 R8 (T38d) files 域 3 路由 zod 迁移落地 + 91.7% 覆盖 |
| `d15beca` | refactor(files): TR-037 R7 files 域 3 路由 zod 迁移 (T38d) + audit 脚本支持多 boundary |

## Notes

- This is an **informational** audit. It does not modify the queue file or
  run any code paths; it produces a report and exits 0.
- **error** drifts are hard inconsistencies that should be reconciled
  before the next cron tick (e.g. `done-missing-commit`, `done_count-mismatch`).
- **warn** drifts are operationally important but not blocking
  (e.g. `blocked-missing-last_error`, `pending-3x-attempts-stuck`).
- **info** drifts are soft signals (e.g. sequence gaps, manual-only
  reminders, conventional-commit advisories).
