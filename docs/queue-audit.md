# VControlHub Cron Queue Audit

Generated: 2026-06-16T17:08:47.711Z
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
| `fe9d09d` | chore(i18n): remove unused coverage parser |
| `ab17df7` | fix(scripts): i18n-coverage 读 dictionaries 替代 translations.ts (R10E spread 后续 bug fix) |
| `8f76f14` | fix(i18n): wire quick services translations |
| `92e4b7b` | docs(queue-audit): E0X closeout — done_count 49→50 (跟 actual done tasks 同步) |
| `aca87cd` | test(i18n): wrap AI/office-preview/quick-services 测试 with I18nProvider (drive-by, 阻 verify) |
| `5a4e8a0` | i18n R10G.13 (TR-054): 接 quick-services 5 文件 52 hardcode 改 t() + quick-services 字典 50 key (card / install-dialog / pending-uninstall / pending-source-delete / page) (35/35 测过) |
| `985f83d` | i18n R10G.11+12 (TR-054): 接 ai 6 客户端 137+ hardcode 改 t() + ai 字典 120 key (sidebar / chat-header / input-area / confirm-dialog / client / settings-panel / provider-panel) (46/46 i18n+ai 测过) |
| `297025c` | feat(dashboard): /dashboard 路由专属页 (TR-052) + 2 pre-existing lint 修复 |
| `6b28ff2` | i18n R10G.7+8+9+10 (TR-054): 接 office-preview 4 key + media-preview 3 key + markdown-preview 4 key + csv-preview 10 key + 4 客户端 19+ hardcode 改 t() (10/10 preview 测过,8/8 i18n 测过) |
| `c6e46ab` | i18n R10G.5+6 (TR-054): 接 archive-preview 12 key + api-docs 11 key + 23 hardcode 改 t() (11/11 测过) |

## Notes

- This is an **informational** audit. It does not modify the queue file or
  run any code paths; it produces a report and exits 0.
- **error** drifts are hard inconsistencies that should be reconciled
  before the next cron tick (e.g. `done-missing-commit`, `done_count-mismatch`).
- **warn** drifts are operationally important but not blocking
  (e.g. `blocked-missing-last_error`, `pending-3x-attempts-stuck`).
- **info** drifts are soft signals (e.g. sequence gaps, manual-only
  reminders, conventional-commit advisories).
