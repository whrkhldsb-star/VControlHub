# VControlHub Cron Queue Audit

Generated: 2026-06-16T15:56:42.542Z
Source: `/root/.hermes/state/vcontrolhub-task-queue.json`

## Summary

| Metric | Value |
| --- | --- |
| Total tasks | 63 |
| done | 50 |
| pending | 8 |
| in_progress | 0 |
| blocked | 2 |
| failed_permanently | 1 |
| Drift count | 19 |

## Top-level checks

| Check | Declared | Actual | OK |
| --- | --- | --- | --- |
| done_count | 50 | 50 | ✅ |
| total | 63 | 63 | ✅ |

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
| `aca87cd` | test(i18n): wrap AI/office-preview/quick-services 测试 with I18nProvider (drive-by, 阻 verify) |
| `5a4e8a0` | i18n R10G.13 (TR-054): 接 quick-services 5 文件 52 hardcode 改 t() + quick-services 字典 50 key (card / install-dialog / pending-uninstall / pending-source-delete / page) (35/35 测过) |
| `985f83d` | i18n R10G.11+12 (TR-054): 接 ai 6 客户端 137+ hardcode 改 t() + ai 字典 120 key (sidebar / chat-header / input-area / confirm-dialog / client / settings-panel / provider-panel) (46/46 i18n+ai 测过) |
| `297025c` | feat(dashboard): /dashboard 路由专属页 (TR-052) + 2 pre-existing lint 修复 |
| `6b28ff2` | i18n R10G.7+8+9+10 (TR-054): 接 office-preview 4 key + media-preview 3 key + markdown-preview 4 key + csv-preview 10 key + 4 客户端 19+ hardcode 改 t() (10/10 preview 测过,8/8 i18n 测过) |
| `c6e46ab` | i18n R10G.5+6 (TR-054): 接 archive-preview 12 key + api-docs 11 key + 23 hardcode 改 t() (11/11 测过) |
| `a7632cd` | i18n R10G.4 (TR-054): 接 recycle-bin-section 11 key + 14 hardcode 改 t() (15/15 file-browser-spa 测过) |
| `17463a9` | i18n R10G.3 (TR-054): 接 snippets 38 key (list + 2 modal 共享 snippetsPage.* 命名空间) + 3 文件 47 hardcode 改 t() |
| `e4bb138` | i18n R10G.2 (TR-054): 接 monitoring 35 key + monitoring-page-client 30+ hardcode 改 t() + test wrap I18nProvider |
| `3d2d2fe` | feat(scripts): i18n-backlog.py 报告生成 + 模板 — 扫未 i18n 页面输出密度表,加速 R10G.N 选页 |

## Notes

- This is an **informational** audit. It does not modify the queue file or
  run any code paths; it produces a report and exits 0.
- **error** drifts are hard inconsistencies that should be reconciled
  before the next cron tick (e.g. `done-missing-commit`, `done_count-mismatch`).
- **warn** drifts are operationally important but not blocking
  (e.g. `blocked-missing-last_error`, `pending-3x-attempts-stuck`).
- **info** drifts are soft signals (e.g. sequence gaps, manual-only
  reminders, conventional-commit advisories).
