# 公开节点状态展示页（参考 Komari）

本文说明 VControlHub 的免登录节点看板：实际交付了什么、借鉴了 Komari 的哪些做法、数据契约、默认私有策略、采样与缓存时效、运行成本与后续路线。宣传口径以本文为准，不超出已实现内容。

## 1. 实际功能

| 位置 | 内容 |
| --- | --- |
| `/`（未登录） | 展示页开启时进入 `/status`；关闭时进入登录页（`/login?next=%2F`）。已登录访问 `/`、`/dashboard` 仍是原管理仪表盘。 |
| `/status` | 公开看板：标题/简介/公告（纯文本）、平台整体状态（可关闭）、在线/离线/陈旧/未采样/维护数量、地区与分组数、实时吞吐合计、本月流量合计、最新采样时间与页面刷新时间；卡片/表格两种视图（本地记住）；按公开名称/地区/分组/标签搜索，按分组、状态过滤；默认顺序（管理员排序）或按名称、状态、CPU、内存、磁盘、网络速率排序；分页（12/24/48/96 每页），查询条件写入 URL。登录账号在看板下方另见原有的内部组件检查与本客户可用率（`?preview=1` 访客预览时隐藏）。 |
| `/status/nodes/<publicId>` | 节点详情：CPU（核数）、负载、内存（含交换）、磁盘（最满分区的使用率及其已用/总量，`df -h` 近似值）、当前上下行速率及其计算窗口、本月流量（注明统计起点）、运行时长、控制端到节点 TCP 延迟；近 24 小时 / 7 天可用率与覆盖率；1h/6h/24h/7d 历史（CPU/内存/磁盘、网络速率、TCP 延迟与失败标记），每张图 ≤ 360 个时间桶并显示分辨率、采样间隔、覆盖率；近 90 天每日可用率条。无终端、重启、命令、文件等任何操作入口。 |
| `/public-status`（平台管理员） | 站点设置：公开开关、标题、简介、公告、默认视图、访客刷新间隔（10/15/30/60 秒）、强调色预设、允许公开的指标类别、是否显示平台整体状态；“以访客身份预览”。节点设置：按服务器搜索/筛选（全部、已公开、未公开、已公开但当前未显示），逐个编辑公开名称/分组/地区/标签/排序/公开说明/维护标记/是否公开，保存前右侧列出访客将看到的字段；批量发布/撤销/维护。设置页“数据”分类中有入口卡片。 |

主题（浅色/深色）与语言沿用访客自己的选择与平台默认设置（PR #35 的 `platform.defaultLocale/defaultTheme`），页面提供切换按钮。

## 2. Komari 来源与取舍

参考快照：`komari` 13cbdca5（MIT）、`komari-web` 9d2c144f（快照内无 LICENSE，**未复制任何源码或素材**，只借鉴信息结构）。官方资料：<https://github.com/komari-monitor/komari>、<https://github.com/komari-monitor/komari-web>、<https://komari-monitor.github.io/komari-document/dev/api.html>、<https://komari-monitor.github.io/komari-document/dev/theme.html>。

| Komari 做法（已核实） | 本项目 |
| --- | --- |
| 首页汇总：在线/总数、地区数、流量合计、速率合计（`komari-web/src/pages/Index.tsx`） | 采用，另加陈旧/未采样/维护计数、最新采样时间与页面刷新时间分列。 |
| 卡片/表格切换存 localStorage，分组 tab，搜索（`NodeDisplay.tsx`） | 采用；搜索/过滤/排序/分页另写入 URL，可分享。 |
| 卡片：CPU/内存/磁盘条、上下行速率、总流量、运行时长（`Node.tsx`） | 采用；缺失值显示“—/未采样”，不像 Komari 那样回落为 0。 |
| Guest 接口过滤 hidden 节点并清除 IP/备注/token（`web/rpc/jsonrpc/common.go`） | 改为**白名单投影**：只拷贝公开字段，不是返回内部对象后清字段。 |
| `private_site` 整站私有 | 对应“公开开关”，默认关闭。 |
| 2 秒 RPC 轮询实时数据 | 不采用秒级；默认 15 秒读已保存样本，见 §5。 |
| 历史查询多聚合、Ping 曲线失败值置空断线、丢包只在统计里（`LoadChart.tsx`、`MiniPingChart.tsx`） | 历史在 PostgreSQL 按时间桶聚合；失败探测画为 x 轴红色刻度，统计写“N 次探测、M 次失败”，不称为丢包。 |
| PingTask 多目标 ICMP/TCP/HTTP、GPU/温度、流量账期、到期计费、主题市场 | 未做，见 §7。 |

## 3. 数据契约

接口（全部 GET、`Cache-Control: no-store`、按客户端地址共用 240 次/分钟限流桶 `public-status`）：

- `GET /api/status/board?q&group&status&sort&dir&page&pageSize`（`pageSize ≤ 100`，越界页码夹到最后一页）
- `GET /api/status/nodes/<publicId>`
- `GET /api/status/nodes/<publicId>/history?range=1h|6h|24h|7d`

展示页关闭、节点未发布/被隐藏、ID 不存在或格式不符，一律返回同样的 404。平台管理员加 `?preview=1` 可在关闭状态下读取，使用同一投影函数。

页面同样给出真实状态码：根 `loading.tsx` 会让页面先流式输出 200 的外壳，之后 `notFound()`/`redirect()` 只能在正文里表达，因此 `src/proxy.ts` 在页面开始流式输出之前用一次索引查询做判断——未登录访问 `/` 得到 307（展示页开启时去 `/status`，否则 `/login?next=/`），不可见的 `/status/nodes/<id>` 改写到不存在的路径，得到应用的 404 页面和 404 状态码。数据库不可用时交回页面自行处理（行为同此前）；平台管理员带 `?preview=1` 的预览由页面判断角色。

节点对象（`src/lib/public-status/types.ts`）只含：`id`（12 位随机 base32，与内部 ID 无关）、`name`、`group`、`region`、`tags`、`note`、`status`、`offlineReason`（`unreachable`/`collect_failed`）、`metricsStale`、`metricsAt`、`checkedAt`、`heartbeatAt`（仅 Agent 节点）、`reportIntervalSeconds`、`metrics`（按站点允许的类别逐项拷贝）。**永不返回**：主机/IP、SSH 端口、用户名、密码/密钥、Agent token、`agentMetricsRaw`、`osDialect`/系统细节、内部名称与描述、客户/团队信息、内部 serverId、错误文本与堆栈、管理链接。站点未允许的指标类别既不返回也不能用于排序（避免以排序泄漏）。

单位：速率为字节/秒（界面以 IEC 单位 B/s、KiB/s、MiB/s 显示），流量与容量为字节，延迟为毫秒，百分比 0–100，时间为 ISO 字符串。**缺失即 `null`**，不填 0。

磁盘口径：节点有多个文件系统时，`metrics.disk` 的 `usage`、`usedBytes`、`totalBytes` 都取**同一个分区——使用率最高的那个**（并列时取 `/`）。这与内部健康状态、磁盘告警以及历史图表所用的 `metric_snapshots.diskUsage` 一致，所以卡片、详情与历史曲线描述的是同一对象；不会再把一个分区的百分比与另一个分区的容量并排显示。容量来自 `df -h` 的取整标签，百分比是 `df` 自己的 `Use%`（不计保留块），二者只近似相等，界面标注“约值”。

> 旧的内部字段 `ServerHealth.networkInKbps/OutKbps` 实际是 `Δbytes ÷ 1024 ÷ 秒`（KiB/s）而非 kbit/s，且首个样本记 0。公开看板不使用它，改由计数器差分计算字节/秒。

## 4. 默认私有与可见性

- 迁移 `20261013180000_public_status_board` 只加表和可空列，不插入任何站点或节点记录：升级后展示页关闭、所有服务器私有。新服务器没有发布记录即为隐藏。
- 运维可选：`ENV_FILE=<运行环境文件> node scripts/public-status-init.mjs [--title VControlHub] [--dry-run]` 在**从未配置过**展示页（无站点行）时把它打开为“空看板”（不显示平台状态、不发布任何节点、不写简介/公告），同一事务写入 `public_status.site.initialize` 系统审计；已有站点行（无论开启还是有意关闭）一律不改。
- 发布需要管理员填写公开名称（不会回退为内部名称或主机），公开文本不得包含该服务器主机地址（服务端校验）。
- 唯一可见性规则（`src/lib/public-status/visibility.ts`）：`已发布 ∧ 服务器启用 ∧ 当前归属 = 发布时记录的归属 ∧ 客户未删除`。列表、详情、历史、汇总全部经过它；服务器禁用、转移到其他客户、客户删除后立即不可见，管理页标出“已公开但当前未显示”及原因，归属变更需管理员重新保存确认。
- 管理接口 `/api/admin/public-status/*` 需要平台专属权限 `team:manage` 并再次断言平台管理员；写操作经 proxy 的 CSRF 校验并写审计日志（发布/开启为 WARNING）。

## 5. 采样、状态与时效

访客请求从不触发 SSH、TCP 探测或 `collectAllHealth`，只读以下已保存数据：

| 数据 | 写入方 | 频率 |
| --- | --- | --- |
| `server_metric_latest`（每台一行，标准化数值） | 健康采样 worker（SSH 与 Agent 过期节点，附 TCP 探测结果）、Agent 上报 | 采样间隔（默认 5 分钟，设置页可调 1–60）；Agent 约 60 秒 |
| `metric_snapshots`（历史，新增 `intervalSeconds`、`probeStatus`、`probeLatencyMs`） | 健康采样 worker | 采样间隔 |
| `traffic_snapshots`（接口计数器，现取第一个非虚拟网卡） | 健康采样 worker | 采样间隔 |
| `server_uptime_snapshots`（每日） | 采样后的 rollup | 采样间隔 |

状态定义（`src/lib/public-status/status.ts`）：维护（管理员标记，优先）；在线（Agent 心跳 < 90 秒，或最近判定在新鲜窗口内且可采集）；离线（最近判定在窗口内但不可达或采不到指标）；陈旧（有过数据但超出窗口，例如 worker 停止）；未采样（从无数据）。新鲜窗口 = max(3 × 写入方记录的间隔, 180 秒)。Agent 心跳新而指标旧时状态为在线，同时单独标“指标已过期”；指标时间用真实采样时间（Agent 用其上报时间），页面刷新时间单独显示。

速率只在同一网卡、计数不减、间隔 ≤ 3 个上报周期时计算，否则为未知；重启（计数回绕）不出现负值或天量；本月流量按增量累加，回绕后按重启后的计数累加，换网卡不计，跨月清零，并显示统计起点。

覆盖率与可用率：每个样本覆盖到下一个样本，最多两倍于其记录的间隔（旧行按当时固定的 5 分钟）；未覆盖时间是“未知”，不计在线也不计离线；覆盖不足一半标“样本不足”。每日 rollup 也改为按真实样本时间计分钟，因此调整采样间隔不会重新解释历史。TCP 延迟图明确为“控制端到节点 TCP 连接耗时”，不是 ICMP Ping，也不是节点到公网的多线路质量；Agent 新鲜时控制端不探测，显示“未采集”。

缓存：只有指标 DTO 在进程内缓存 5 秒（单飞加载），任何发布/站点保存都会立即清空。每次请求仍读取站点设置（主键）和当前可见的公开 ID 集合（一次不连指标的轻量查询），缓存列表按这个集合即时过滤并重算汇总；集合里出现缓存没有的节点就立即重建。因此关闭展示页、改变公开指标、撤销发布、服务器禁用、转移到其他客户、客户删除，在所有进程中都即时生效，不依赖缓存过期。详情与历史每次请求都重新做可见性查询，历史结果另缓存 30 秒（可见性检查之后）。客户只有“删除”（`Team.deletedAt`）一种停用状态，没有单独的禁用/暂停；账号级的 `DISABLED` 不影响客户名下服务器的公开。浏览器端：默认 15 秒轮询，页面隐藏时暂停、恢复可见时补拉，单请求 10 秒超时，失败指数退避（上限 5 分钟），不重叠请求，失败时保留上次数据并显示获取时间与重试按钮。

## 6. 运行成本（本轮基线）

脚本：`DATABASE_URL=<隔离测试库> npx tsx scripts/load/public-status-baseline.ts 200 500`（在 PostgreSQL 驱动层计数实际发送的 SQL，并拦截任何非数据库的出站 TCP 连接）。2026-10-13 在本机隔离 PostgreSQL 16 上的结果：

| 节点数 | 读路径 | SQL 条数 | 响应体 | 耗时 |
| --- | --- | --- | --- | --- |
| 200 | 看板首次（缓存空，24/页） | 6 | 23.1 KB | 64 ms |
| 200 | 看板缓存命中（24/页 / 100/页） | 2 | 23.1 KB / 88.3 KB | 3 ms |
| 500 | 看板首次（24/页） | 6 | 23.2 KB | 47 ms |
| 500 | 看板缓存命中（搜索+排序） | 2 | 23.2 KB | 3.6 ms |
| 500 | 节点详情（含 24h/7d 可用率与 90 天） | 5 | 10.3 KB | 15 ms |
| 500 | 历史 24h 首次 / 命中 | 5 / 2 | 63.8 KB | 10 ms / 2.6 ms |
| 500 | 历史 7d 首次 | 5 | 79.9 KB | 16 ms |

非数据库出站连接：0。看板 SQL 条数与节点数无关：首次 = 站点设置 + 可见 ID 集合 + 一次 JOIN 读取全部可见节点 + 平台整体状态 2 条；命中缓存时只剩站点设置与可见 ID 集合 2 条。首次耗时含连接池建立，波动较大。以上是单进程、本机回环数据库的数字，不代表并发容量；未做压测，也不承诺秒级实时。

## 7. 后续路线（未在本轮实现）

- 节点侧多目标 ICMP/TCP/HTTP 探测任务（Komari PingTask），需要 Agent 协议扩展与结果存储。
- GPU、温度、进程数、TCP/UDP 连接数等指标（当前采集脚本不提供）。
- 流量账期、流量上限、到期/计费展示。
- 实时通道（SSE 推送 latest 变化）与更细的 Agent 上报间隔（目前 60 秒）。
- 主题/插件市场、自定义 HTML；目前只提供标题、简介、公告与有限强调色。
- 自动发现与自动发布（刻意不做：发布必须是管理员的显式动作）。

## 8. 验证

- 单元与路由测试：`src/lib/public-status/__tests__/`、`src/app/api/status/__tests__/public-board-routes.test.ts`、`src/app/api/admin/public-status/__tests__/`、`src/app/status/__tests__/`、`src/__tests__/proxy.test.ts`。
- PostgreSQL 集成：`src/lib/public-status/public-status.integration.test.ts`（latest upsert 的速率/回绕/换网卡/跨月/幂等、可见性与撤销、归属变更、关闭与预览、历史 SQL、覆盖率、rollup、采样写入）。
- 浏览器：`e2e/public-status-board.spec.ts`（访客根入口与看板、视图/搜索/过滤/排序/超过 200 节点分页、详情与时间窗、猜测 ID 404、管理员发布→访客可见→撤销、关闭与预览、320/390/768/1440 中英文深浅色、主题切换），Chromium/Firefox/WebKit。
