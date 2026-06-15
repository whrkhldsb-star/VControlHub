# TR-002 R4 启动期公网暴露探测 — T31 收尾 tick (2026-06-15 ~19:45Z)

**Status**: done · **Commit**: `c8aa938` · **Predecessor closeout**: `references/tr-002-tick-2026-06-15-t31-closeout.md` (initial implementation, blocked on deploy)

## 范畴

T31 已经在前一 tick 提交了实现 (`c8aa938 feat(direct-gateway): TR-002 R4 startup public exposure probe`):

- `src/instrumentation.ts` 启动后异步 fire `directGatewayPublicProbe()`, 命中 HTTP 200 时 `logger.warn` 提示"31888 端口监听公网", 含 `host / port / url / status` 上下文
- 285 file / 1869 test 全过, tsc/eslint clean

但部署被 **pre-existing Caddyfile 重复全局块阻塞** (P-001-R 同源新症): `/etc/caddy/Caddyfile` 累积到 452 行 / 10 个 `{` 全局块 / 12 个重复站点块, `caddy validate` 报 *"server block without any key is global configuration, and if used, it must be first"*, deploy.sh 拒绝继续。

本 tick 的任务: 解阻塞 + 部署 + 实证探针在生产真的发出告警。

## Caddyfile 修复

| 步骤 | 命令 / 结果 |
|---|---|
| 损坏现状 | `wc -l /etc/caddy/Caddyfile` → 452 行 / 12673 B; `grep -c '^{$'` → 10 个全局块 |
| 备份枚举 | 找到最近干净备份 `/etc/caddy/Caddyfile.bak.20260615082955` (31 行, 797 B) |
| 损坏快照 | `cp /etc/caddy/Caddyfile /etc/caddy/Caddyfile.bak.broken-20260615194157` (保留取证) |
| 恢复 | `cp /etc/caddy/Caddyfile.bak.20260615082955 /etc/caddy/Caddyfile` |
| 验证 | `caddy validate --adapter caddyfile --config /etc/caddy/Caddyfile` → "Valid configuration" |

恢复后 deploy.sh 第 27-61 行的 awk 注入逻辑仍工作 — 它有 `grep -q 'reverse_proxy /direct'` 守卫, 干净文件 + 守卫 = 后续 deploy 不会再次累积重复块。

**未追溯重复来源** (推测早期 deploy.sh 的 awk 逻辑无幂等守卫, 或并发 deploy tick 撞 race), 本 tick 不深挖。

## Deploy + 探针实证

```bash
sudo bash /opt/VControlHub/deploy.sh
# 输出关键行:
#   ==> [2.5/6] Apply prisma migrations: "Database schema is up to date"
#   ==> [3/6] Restart services: vcontrolhub-next.service / vcontrolhub-ssh-ws.service
#   ==> [5/6] Smoke test: 25/25 PASSED
#   WARNING: vcontrolhub-direct.service 未显式声明 DIRECT_BIND  ← 已知遗留, 不阻断
```

部署后 60s journalctl 抓到**预期** WARN:

```json
{
  "level": "warn",
  "scope": "direct-gateway-probe",
  "message": "Direct Gateway 公网可达：检测到 HTTP 200 响应（31888 端口监听公网），请检查 DIRECT_BIND / Caddy 反代 / 防火墙",
  "timestamp": "2026-06-15T23:45:22.218Z",
  "context": {
    "host": "82.158.91.159",
    "port": 31888,
    "url": "http://82.158.91.159:31888/__vch_health",
    "status": 200
  }
}
```

这是 R4 任务的核心实证: **探针在启动期发现公网 31888 暴露并发出告警**。R4 deliverable 完整。

## 三连 verify

| 项 | 结果 |
|---|---|
| `curl https://whrkhldsb.qzz.io/api/status` | `200` (0.086s) |
| `npx prisma migrate status` | "Database schema is up to date" (17 migrations) |
| `journalctl -u vcontrolhub-next.service --since "60 sec ago"` | 0 error, 1 expected WARN (R4 探针自报) |

## 衍生发现 (不属于 T31, 留 backlog)

| ID | 描述 | 行动建议 |
|---|---|---|
| Caddyfile 自愈 | deploy.sh awk 注入需要幂等守卫加固 (现有 `grep -q 'reverse_proxy /direct'` 已工作, 但**全局块**注入逻辑仍无守卫, 长期可能累积) | 加 `grep -q '^{$'` 跳过 / 或改用 `caddy adapt` 写盘 |
| 31888 公网暴露 | R4 探针告警的根因: `vcontrolhub-direct.service` 未声明 `DIRECT_BIND=127.0.0.1` | 单独 P1 task: 改 `/etc/vcontrolhub-direct.env` + 防火墙 31888 inbound deny |
| 损坏 Caddyfile 来源 | 12 重复块来源未追溯 | 取证文件 `Caddyfile.bak.broken-20260615194157` 保留, 必要时审计 |

## 新坑 (沉淀)

### P-001-R2: Caddyfile 重复全局块 — deploy.sh 不抛错前先 `caddy validate` (强化 P-001-R)

P-001-R 教了 "deploy.sh 缺 `prisma migrate deploy` 步骤"; P-001-R2 是同源 deploy 流水线的另一段:

**症状**: `deploy.sh` 跑 `systemctl reload caddy` 失败但**继续往下走** (没 set -e 严格模式), 半成品部署 + Caddy 仍跑旧配置 → smoke 还能过 (因为 Caddy 旧配置正常), 但下次 reload 就**全员 502**。

**修复范式** (本 tick 用):
1. deploy.sh 在改 Caddyfile **之前**应该 `caddy validate` 当前文件, 失败立即 abort
2. 改完 awk 注入 **之后**再 `caddy validate`, 失败 rollback 到 backup
3. **本 tick 实战**: 手动恢复备份解阻塞, deploy.sh 自身的守卫加固留给单独 task

**判断流程**:
- 任何 deploy.sh 修改 `/etc/caddy/`, `/etc/systemd/`, `/etc/nginx/` → **必须** validate-before-write + validate-after-write + rollback-on-fail
- 不能假设上游配置干净 (本案例: `/etc/caddy/Caddyfile` 累积到 452 行 才被发现)

### P-001-R3: 探针类任务的"成功"信号 = 在生产看到 WARN, 不是看不到 WARN

写"启动期检测公网暴露"探针时, 容易陷入"WARN = bug"误区。**探针的 deliverable 是检测能力, 不是 0 告警**。本 tick 探针在生产首次启动就发 WARN, 这是**预期行为**, 证明:

- 探针在 instrumentation.ts 真的启动 ✅
- HTTP probe 真的能打通公网 ✅
- 日志格式 `{ scope, level, context }` 真的对接 logger ✅
- 31888 真的暴露公网 ✅ (这是 R4 探针告诉我们的, 不是 R4 的 bug)

**反模式**: 看到生产 WARN 就回滚 R4 commit, 误判"探针有 bug"。

正确做法: 探针 WARN → 开 follow-up task 处理告警的根因 (DIRECT_BIND / 防火墙), R4 本身关闭。

## Tick metrics

- 工具调用: ~12 (Caddyfile 检查/恢复 4 + deploy 2 + verify 4 + queue update 1 + closeout 1)
- 改动文件: 0 业务代码, 1 infra 配置 (`/etc/caddy/Caddyfile` 恢复, 不入 git)
- 测试: 沿用前 tick 的 285 file / 1869 test (无新代码, 不需要重跑)
- 部署: smoke 25/25, 探针实证

## 后续 (非本 task)

1. **新 P1 task**: DIRECT_BIND=127.0.0.1 配置 + 31888 inbound deny iptables 规则 — R4 告警的根因
2. **新 P2 task**: deploy.sh Caddyfile 注入幂等性加固 (validate-before-write + rollback)
3. **可选取证**: 追溯 `Caddyfile.bak.broken-20260615194157` 12 重复块根源 (推测 cron tick 撞 race)
