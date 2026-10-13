# 2026-10-12 审查结论核验与修复记录

本文记录对《VControlHub 全面审查报告》（2026-10-12，基准 `b27f9b90`）R01～R16 的独立核验、修复与验证。面向没有参与讨论的维护者：每项都给出结论分类、当前源码依据、触发条件与风险界限、修复方式、回归证据和对应提交。

- 工作分支：`fix/verified-audit-20261012`；起点 `8e8980cd`（已含 PR #30 知识库提示隔离、PR #31 UI 修复）。
- 核验以起点源码为准，不以报告中的历史快照为准。下文的“依据”行号均指 `8e8980cd`。
- PR #30 已修复的“知识库片段注入 system 消息”问题按报告说明排除，本次未改动。
- 所有验证都在独立工作区和一次性测试数据库中进行（见第 5 节）；没有部署、没有重启服务、没有连接生产数据库或真实 VPS，也没有对外发送通知。

## 1. 结论速览

分类含义：**confirmed** 当前代码中缺陷真实存在；**partially-confirmed** 报告描述部分成立，或部分属于设计取舍；**false-positive** 不成立；**already-fixed** 起点前已修复。本次 16 项中没有 false-positive，也没有 already-fixed。

| 编号 | 分类 | 一句话结论 | 修复状态 | 提交 |
| --- | --- | --- | --- | --- |
| R01 | confirmed | 同步前对源目录 `mkdir -p`，MIRROR/删除孤立项会把“源缺失”变成“清空目标” | 已修复 | `9f68e319` |
| R02 | confirmed | tar 回退只看管道末端退出码；镜像模式先清空目标再解包 | 已修复（含提交阶段可恢复） | `80d06d05`、`958c54f4` |
| R03 | confirmed | 恢复锁按 backupId 加，不同备份可并发恢复同一目标 | 已修复 | `1c35d1d5` |
| R04 | partially-confirmed | SQL 非单事务、FULL 先文件后库、恢复期间 Worker 照常运行；文件“覆盖合并”是语义而非缺陷 | 已修复可修部分；交互式写入与“精确还原”模式列为剩余 | `b0de217e` |
| R05 | confirmed | Playbook 超时后发出取消即重试，旧命令仍在 CANCELLING | 已修复 | `2d3c4c10` |
| R06 | confirmed | 定时任务认领用 +24h 哨兵覆盖 nextRunAt，崩溃后跳过一天并丢失原 occurrence 幂等键 | 已修复（含迁移） | `4540ced5` |
| R07 | confirmed | 快捷应用重建：inspect 任意错误当“不存在”、rename 失败退化为 `rm -f`、不验收运行状态、start 大范围 catch | 已修复 | `ed7bdf60`、`1d7f6229` |
| R08 | confirmed | 告警首次投递失败的渠道，事件持续 OPEN 时不再补投 | 已修复（含迁移） | `8b291872` |
| R09 | confirmed | 搜索对任意 docker:manage 持有者返回 Hub 主机快捷应用元数据 | 已修复 | `cf1af656` |
| R10 | confirmed | 分享列表固定 200 条，无分页/搜索 | 已修复 | `c80b8b89` |
| R11 | confirmed | 媒体列表固定 200 条，收藏数只算当前批次 | 已修复（详情页上下项仍限 200，列为剩余） | `a00ddec6` |
| R12 | confirmed | 任务中心先按来源截断再按状态/类型筛选 | 已修复 | `e5fa6201` |
| R13 | confirmed | 知识库候选先按时间取 200 再算相关度 | 已修复召回排序；向量/全文检索不在本次范围 | `24b7c0a1` |
| R14 | confirmed | 可用率只表达已采样成功比例，不显示采样覆盖 | 已修复展示层；“采样器故障/主机不可达”区分列为剩余 | `84442ef3` |
| R15 | confirmed | k6 包装脚本 ROOT 指向 scripts/，路径变成 scripts/scripts/… | 已修复（仅入口，未做容量压测） | `14ecfd3b` |
| R16 | confirmed | RBAC 审计无条件 exit 0，且不在 CI 中 | 已修复并接入 CI | `2e756b93` |

另有一个文档提交 `eb1f65cd`（README 指标随新增组件更新，`docs:check` 门禁要求）。

## 2. 逐项核验与修复

### R01 镜像源缺失被自动创建后删除目标 — confirmed

- **依据**：`src/lib/sync/service-runtime.ts:211` 每条同步腿都对源路径执行 `mkdir -p`；`src/lib/sync/bidirectional.ts:12` 使 MIRROR 恒为删除孤立项（rsync `--delete`、tar 回退清空目标）。
- **触发与界限**：源路径被误改/删除、挂载点未挂载（空目录）时，同步把目标当作“应删除的孤立数据”清空。rsync 与 tar 两条路径都会发生。双向同步不删除孤立项，不受影响。
- **修复**：源目录改为只探测不创建（`buildSyncSourceProbeCommand`）。缺失或不可读直接失败；源存在但为空、且本次会删除孤立项、目标非空时拒绝执行（无法区分“确实要清空”与“挂载丢失”，项目也没有“显式清空目标”操作）。只有双向同步（永不删除）仍可创建缺失的一侧，以保留首次播种行为。
- **证据**：`src/lib/sync/__tests__/mirror-source-guard.test.ts` 端到端运行 `executeSyncJob`，SSH 层替换为本机 `/bin/sh`，在真实临时目录上执行全部远程命令。修复前 5 例中 3 例失败（目标被清空、源被创建）。
- **剩余**：未实现挂载身份校验（例如源根标记文件）和删除比例阈值，属于后续可选增强。

### R02 tar 管道错误被掩盖 — confirmed

- **依据**：`src/lib/sync/service-commands.ts:196` 生成 `tar cf … | ssh … 'tar xf …'`，shell 只返回末端状态；`:194` 镜像模式在解包前先 `find … -exec rm -rf`。
- **触发与界限**：源端读错误在输出合法的部分归档后非零退出，整体仍为 0；目标磁盘满或断流时目标已被清空。只影响源主机没有 rsync 的 tar 回退路径。
- **修复**：
  - 先完整接收到目标目录内的 `.vch-sync-stage-<job>`。源 tar 状态经临时文件带出管道，两端都为 0 才提交，否则删除暂存、目标不变。
  - 镜像提交（`958c54f4`）把现有条目先移入 `.vch-sync-prev-<job>`，再移入新条目，最后删除旧副本。任何移动失败都把旧条目移回。
  - 若提交被整体打断（例如 SSH 中断），旧条目保留在 prev 目录，下次运行拒绝提交并提示人工处理。
  - 不触碰其他作业的 stage/prev 目录。
- **证据**：`src/lib/sync/__tests__/tar-sync-fault-injection.test.ts` 用伪 `ssh`/`tar`/`mv` 在真实文件上注入故障，覆盖源端失败、接收端磁盘满、提交阶段 mv 失败、上次提交中断、其他作业暂存目录，并核对目标逐项内容。修复前首批 6 例中 3 例失败；提交阶段新增 3 例在旧提交脚本下全部失败。
- **界限**：暂存需要目标端约一份额外空间。合并模式用 `cp -a` 覆盖，被中断时正在复制的单个文件可能不完整，但不会删除任何内容（与原直接解包相同）。若之后改用 rsync `--delete`，残留的 prev 目录会被当作孤立项删除，所以出现“中断”提示时应先处理。

### R03 恢复互斥按 backupId 而非恢复目标 — confirmed

- **依据**：`src/lib/backup/service-runtime.ts:276` 用 `acquireAdvisoryLock("backup-restore", input.id)`；`src/app/api/backups/[id]/restore/route.ts:42` 的 `wait=1` 直接执行，`:59` 仅按同一 backupId 查重；`scripts/restore.mjs` 与 `restore-*.sh` 无互斥。
- **修复**：应用内恢复改为平台唯一的非阻塞锁，占用时返回 409“已有恢复在运行”。`restore.mjs` 与 `restore-files.sh` 增加主机级锁 `APP_DIR/.restore.lock`（mkdir 原子创建，记录 pid/host）：CLI 与应用不能同时恢复；同机已死进程留下的锁可回收，活着的持有者绝不被替换。
- **证据**：`restore-mutex.integration.test.ts` 使用真实 PostgreSQL advisory lock，让恢复 A 停在破坏性步骤内，断言恢复 B 被拒（修复前 B 继续执行）；`scripts/__tests__/restore-runner.test.ts` 分别覆盖 node 与 bash 入口的活锁拒绝、死锁回收。
- **界限**：“恢复与升级/部署互斥”未实现，`deploy.sh` 有自己的部署锁，两者之间没有冲突矩阵（见第 6 节）。

### R04 在线恢复缺少停写与一致性 — partially-confirmed

- **依据**：`scripts/restore.mjs:61` 仅用 `-v ON_ERROR_STOP=1` 导入，无单事务；`:235` FULL 先恢复文件再导入数据库；恢复期间 Worker 继续领取任务。
- **成立的部分**：SQL 中途失败时之前的 DROP/CREATE/COPY 已提交，得到半恢复的数据库；FULL 中数据库失败会留下“新文件 + 旧库”；后台任务可能在数据被替换期间写回旧状态。
- **不认定为缺陷的部分**：`restore-files.sh` 的 `cp -a`/Node `fs.cp` 是覆盖合并（备份后新增的文件保留），这是一种恢复语义，不是错误。本次在文档中明确说明，未新增“精确还原”模式。
- **修复**：
  1. `psql --single-transaction -f -`：导入要么全部生效，要么完全回滚。已用真实迁移后的完整应用 schema 验证可在单事务中恢复。
  2. FULL `all` 改为：先解压并校验文件到暂存区，再执行数据库事务，提交后才复制文件。数据库失败时数据库与文件都不变；文件复制失败（数据库已提交）时明确报告 `PARTIAL RESTORE`。
  3. 后台停写与排空：恢复持锁期间，`claimNextJob` 与 `executeSyncJob` 都不启动新工作（通过 `pg_locks` 看到恢复锁，该状态不在被恢复的数据里，跨实例可见）。恢复在拍安全快照前最多等待 120 秒让运行中的任务/同步结束，仍未结束则返回 409 且不改动任何数据。
  4. 失败信息写明可用于回退的安全快照 ID/路径；每次恢复结果追加到 `<备份根>/restore-history.jsonl`，因为恢复任务自身的 Job 行位于被替换的数据库里。
- **证据**：
  - `restore-atomicity.integration.test.ts`（真实 PostgreSQL）：dump 在数据语句之后失败时，数据库与文件都保持原样（修复前数据库变为备份内容、文件被替换）；真实应用 schema 单事务恢复成功。
  - `restore-quiesce.integration.test.ts`：持恢复锁时 `claimNextJob` 不领取，释放后恢复（修复前照常领取）。
  - `src/lib/backup/__tests__/service.test.ts`：排空超时在快照前拒绝、自身任务被排除、失败信息带快照。
- **剩余边界**：交互式 API 写入在恢复期间不会被拒绝，只会在数据库事务期间被表锁阻塞；FULL 的“数据库已提交、文件复制失败”仍是一个已标明的部分状态；没有影子库切换、恢复后的登录/凭据解密自动探针。是否引入全站维护模式需要产品决策。

### R05 Playbook 取消确认屏障 — confirmed

- **依据**：`src/lib/playbook/executor.ts:113` 超时调用 `cancelCommandRequest` 后立即抛错；`:380` 重试回调删除当前步骤记录，下一次尝试用新幂等键创建命令；取消运行中的命令只会进入 CANCELLING（`service-requests.ts:322`）。
- **修复**：发出取消后最多等待 60 秒（继续心跳），直到旧请求进入终态：非 COMPLETED 终态按普通超时处理、允许重试；取消过程中实际 COMPLETED 的按成功处理；始终未终止则抛出 `CommandOutcomeUnknownError`，步骤失败且不再重试。
- **证据**：`executor-cancel-barrier.test.ts`（假时钟）。旧请求卡在 CANCELLING 时，修复前创建了 3 个重叠的命令请求，修复后只有 1 个。
- **界限**：未实现“步骤幂等声明/人工确认”，非幂等步骤在取消确认后仍会按配置重试。

### R06 定时任务认领崩溃窗口 — confirmed

- **依据**：`src/lib/scheduled-task/worker.ts:138,145` 认领时把 nextRunAt 改为 24 小时后的哨兵，幂等键由当时的 nextRunAt 构成。
- **修复**：新增可空列 `ScheduledTask.claimedOccurrenceAt` 保存被认领的 occurrence，nextRunAt 只作 10 分钟租约。租约过期后下一次 tick 重领同一 occurrence，用同一幂等键（`CommandRequest.idempotencyKey` 唯一），已创建的命令被重放而不是再执行一次，然后补记运行记录。记录派发/运行、暂停/恢复、修改计划时清除认领。
- **证据**：`claim-crash-recovery.integration.test.ts`（真实 PostgreSQL、假时钟）让第一个 Worker 在创建命令后“死亡”，租约过期后被同 occurrence、同幂等键重领。修复前 nextRunAt 被推后 24 小时。
- **迁移**：`20261012120000_scheduled_task_claimed_occurrence`，见第 4 节。

### R07 快捷应用破坏性回退与健康验收 — confirmed

- **依据**（`src/lib/quick-service/service-lifecycle-install.ts`）：
  - `:290` inspect 任何异常都当作“不存在”，`docker run` 撞名失败后清理逻辑会 `rm -f` 现有容器；
  - `:301-303` rename 失败退化为 `rm -f`；
  - 运行后不验收状态就删除旧容器并标记 running；
  - 安装失败路径再次 `rm -f` 容器名，可能删掉刚被恢复的旧容器；
  - `service-lifecycle.ts:213` 的 startService 用一个大 catch 包住 start、数据库更新和审计。
- **修复**：
  - 只有 Docker 自己报告“No such container/object”才视为不存在，其他 inspect 错误与 rename 失败都中止且不做任何改动。
  - 新容器需在稳定期后仍 running、无重启、健康检查非 unhealthy；健康检查 90 秒后仍为 starting 时报告为待定而不判失败。否则删除新容器、改回并启动旧容器。
  - 清理问题追加到错误信息中，不再吞掉；去掉安装失败路径的重复 `rm -f`。
  - startService 仅在容器确实不存在时重建；其他启动失败直接报错；启动成功后的记账错误不再触发重建。
- **证据**：`recreate-rollback.test.ts` 用内存 Docker 守护进程模型执行安装/启动/更新，并断言之后存在哪些容器。修复前 9 例中 7 例丢失或替换了旧容器。
- **界限**：没有应用层就绪探针（HTTP readiness）、镜像 digest 记录或数据卷恢复点；更新的回滚依赖旧容器仍引用旧镜像。安装与更新因验收稳定期约增加 10 秒。

### R08 告警失败渠道补投 — confirmed

- **依据**：`src/lib/alert/incidents.ts:294` 对 OPEN/ACKNOWLEDGED 事件只更新数值并返回，失败渠道没有被持久化。
- **修复**：事件上新增投递状态（`pendingNotifyChannels`、`notifyAttempts`、`nextNotifyAt`、`lastNotifyError`），与事件状态分离。事件保持 OPEN 时，后续评估只向未送达渠道补发“触发”通知：按 1/2/4…60 分钟退避，最多 8 次；已送达渠道不重复打扰。补发前用 nextNotifyAt CAS 认领，防止并发评估重复发送。确认或解决后停止补投。告警列表显示“告警已触发，但通知未送达：…（自动重试中/已停止重试）”及最后错误。
- **证据**：`incident-delivery-retry.test.ts`（按真实 where 条件执行 CAS 的有状态事件存储、假时钟）：首次 webhook 503，恢复后补投成功且邮件不重复；退避与上限；确认/解决后不补投。修复前 webhook 永不补投。
- **界限**：同一渠道内只要任一收件人成功即视为送达，未做逐收件人追踪；升级通知的失败重试未纳入本机制。
- **迁移**：`20261012130000_alert_incident_delivery_retry`。

### R09 搜索的 Hub 快捷应用范围 — confirmed

- **依据**：`src/app/api/search/route.ts:103` 对任意 docker:manage 持有者查询 `{ serverId: null }`；Hub Docker 访问由 `assertHubHostDockerAccess` 限定为平台管理员；原测试固定了宽松条件。
- **界限**：只泄露名称/描述/状态等元数据，不能借此操作容器。
- **修复**：仅平台管理员的搜索包含 Hub 主机安装实例。
- **证据**：`search/__tests__/route.test.ts` 中，Hub 独有应用对客户不可见、对管理员可见（修复前失败）。同 slug 跨节点去重属于展示问题，未改。

### R10 分享列表 200 条 — confirmed

- **依据**：`src/lib/share-link/service.ts:260` `take: 200`；`/shares` 直接渲染该列表。
- **修复**：`listShareLinkPage` 在数据库中完成客户隔离、状态筛选（有效/过期/撤销）和名称/路径/创建者搜索，按 createdAt+id 稳定分页，并返回真实总数。页面增加搜索、状态筛选和上一页/下一页（新组件 `LinkPagination`）。`GET /api/share-links` 支持可选的 `page/pageSize/status/q`；不带参数时仍返回最新 200 条，并新增 `total/page/pageSize`。
- **证据**：`share-list-pagination.integration.test.ts`（真实 PostgreSQL，205 条，最旧一条仍有效）：真实总数、最后一页能找到、205 条各出现一次、筛选、无跨客户。同一数据下旧函数只返回 200 条且不含最旧的有效分享。

### R11 媒体列表 200 条 — confirmed

- **依据**：`src/lib/media/service.ts:161` `take: 200`；页面收藏数由当前批次计算。
- **修复**：列表支持 page/pageSize，按 favorite、updatedAt、id 稳定排序（扫描会批量写入相同时间戳）。`countMediaItems` 与列表、类型计数共用同一筛选构造。页面显示真实匹配数和数据库收藏数，分页链接保留筛选条件。`GET /api/media` 返回 `total/page/pageSize`。
- **证据**：`media-pagination.integration.test.ts`（450 条相同 updatedAt，逐页不重不漏、数据库计数）；`media/__tests__/page.test.tsx`（5000 条中第 3 页、收藏数来自数据库、分页链接）。
- **剩余**：媒体详情页的“上一项/下一项”仍只在同类型前 200 条内导航。

### R12 任务中心筛选前截断 — confirmed

- **依据**：`src/lib/operation-task/service.ts:282` 各来源先 `take: limit`，`:304` 再筛选。
- **修复**：把请求的状态逆映射到各来源的原始状态值，在 `take` 之前下推到查询：
  - 枚举列按其枚举值；自由文本列对 pending 开放匹配；
  - SyncJob 的“从未运行的 IDLE”、关联命令的部署单独处理；
  - 任务类型下推到 jobs/backups，没有类型的来源直接排除；
  - attention 排序且无状态筛选时，每个来源额外取一次需关注行；
  - 内存筛选保留作为最终判定。
  
  顺带修正 SyncJob `ERROR` 被映射为 pending 的问题（现为 failed）。
- **证据**：`filter-pushdown.integration.test.ts`（真实 PostgreSQL）：一个旧 RUNNING 任务之后有 30 个新完成任务、limit=10 时，status=running、sort=attention、类型筛选均能找到它（修复前三者都失败）；所有状态值对所有来源都能生成合法查询。
- **界限**：未实现全局游标分页和统一 correlationId 时间线。

### R13 知识库候选召回 — confirmed

- **依据**：`src/lib/ai/knowledge.ts:350` 只取 50 个知识库；`:357` 只用前 8 个词；`:372` 按 createdAt 倒序取 200 个候选后才打分。
- **修复**：候选集由 SQL 按与内存打分一致的权重排序（整句 12、≥4 字符词 3、短词 2，覆盖全部查询词），只取 READY 文档，时间只作并列排序；LIKE 通配符转义；知识库上限 500 并固定排序。最终排序仍由原打分器完成。
- **证据**：`knowledge-recall.integration.test.ts`（真实 PostgreSQL）：250 条只含常见词的新块之后，匹配所有词的旧 SOP 排第一（修复前失败）；新块仍可按其自身查询召回；通配符按字面处理；无跨客户结果。
- **不在范围**：全文/向量检索、中文分词、截断信息返回与评测集。

### R14 可用率覆盖质量 — confirmed

- **依据**：`src/lib/uptime/rollup.ts:55` 计算 online/checkCount；`src/app/status/page.tsx:124` 提示只显示百分比；SLA 只按样本加权。
- **修复**：按采样间隔计算每日预期样本数（5 分钟间隔为 288，当天按已过时间折算）。提示显示“在线% · 实际/预期样本（覆盖%）”。覆盖低于 50% 的日期改为中性色加警示描边、标注“样本不足”。SLA 旁显示窗口采样覆盖率（从首个有样本日起算，新增主机不被惩罚）。说明文字解释百分比含义。无 schema 变更。
- **证据**：`status/__tests__/page.test.tsx`：一天只有 1 个在线样本时不再显示为成功色（覆盖 0%、1435 分钟未知），满样本日正常，当天按已过时间判断，窗口覆盖从首个样本日起算。
- **剩余**：rollup 未记录缺样原因，无法区分“采样器故障”“主机不可达”“应用不可用”。

### R15 k6 入口路径 — confirmed

- **依据**：`scripts/load/run-k6-baseline.sh:5` 把 ROOT 设为 scripts/，再拼接 `scripts/load/k6-baseline.js`。
- **修复**：ROOT 改为仓库根。
- **证据**：`scripts/__tests__/load-baseline-entry.test.ts` 用不联网的 k6 shim 记录收到的脚本路径（修复前为 `scripts/scripts/load/...`）。本次只验证入口，没有进行任何容量压测，不能据此宣称性能达标。

### R16 RBAC 审计门禁 — confirmed

- **依据**：`scripts/rbac-audit.ts:798` 无条件 `process.exit(0)`；只在本地 `test:merge` 中调用，CI 不运行。
- **修复**：发现阻断型漂移（除软信号 `page-button-perm-unused` 外的全部类别）时 exit 1。有意公开的路由仍是 `api-no-declared-perm` 白名单中的已审查例外。`--no-write` 不改写受版本控制的报告，`--report-only` 保留原信息模式。已接入 CI test 作业、`ci:local` 和 `test:merge`，说明见 `docs/ci-gates.md`。当前代码 0 漂移，门禁通过。
- **证据**：`scripts/__tests__/rbac-audit-gate.test.ts` 以子进程在夹具仓库中运行审计（使用真实 rbac.ts）：声明 server:read 却不校验的路由 exit 1（修复前 exit 0），正确校验的路由 exit 0。

## 3. 关于 F-01～F-47 矩阵

矩阵用于理解产品目标，本次没有把其中的设计建议扩展为新功能。涉及的、仍待产品决策的方向见第 6 节，例如有效权限模拟器、全站维护模式、精确恢复模式、步骤幂等声明、统一 correlationId 时间线。

## 4. Schema 迁移与兼容性

| 迁移 | 内容 | 兼容性 |
| --- | --- | --- |
| `20261012120000_scheduled_task_claimed_occurrence` | `scheduled_tasks."claimedOccurrenceAt" TIMESTAMP(3)` 可空 | 只增不改。旧代码忽略该列；无需回填。回滚旧代码后，残留的认领值只会在新代码再次部署时被使用或清除。 |
| `20261012130000_alert_incident_delivery_retry` | `alert_incidents` 增加 `pendingNotifyChannels TEXT[] DEFAULT '{}'`、`notifyAttempts INT NOT NULL DEFAULT 0`、`nextNotifyAt`、`lastNotifyError` | 只增不改、带默认值。旧代码忽略；已有事件视为无待补投。 |

`prisma migrate deploy` 已在一次性数据库上从空库应用全部迁移，`prisma migrate diff`（迁移后数据库对 schema.prisma）为空，`prisma format --check` 通过。

**行为变化（发布说明需要提及）**：
- 单向/镜像同步的源目录不存在时，作业失败而不再自动创建。
- 平台恢复同一时间只能有一个，后台仍有任务运行时最多等待 120 秒后返回 409。
- 快捷应用安装、更新约多 10 秒验收。
- `GET /api/share-links`、`GET /api/media` 响应新增 `total/page/pageSize` 字段（原字段不变）。
- CI 新增 RBAC 漂移门禁。

## 5. 验证环境与结果

- **依赖**：在工作区执行 `npm ci`，生成独立的 `node_modules` 与 Prisma 客户端。没有使用生产的 node_modules/.next/dist，也没有复制 `.env` 或密钥。
- **测试数据库**：用系统自带的 PostgreSQL 16 二进制，以 `postgres` 用户在 `/tmp/claude-audit-pg-20261012` 新建独立集群（端口 55439，数据库 `vcontrolhub_audit_test`）。与生产实例（5432）完全分离；集成测试自建自删数据。
- **原报告实验**：`proofs.py` 复制到 `/tmp/claude-audit-work/` 并把 REPO 改为本工作区后执行，修复前在本工作区复现了全部 4 个现象。修复后再次执行：
  - tar 源端失败现在返回 1，目标未收到部分数据；k6 入口拿到存在的脚本。
  - restore-files 覆盖合并为既定语义，结果不变。
  - 第 1 例仍显示目标被清空，这是预期结果：该脚本自行 `mkdir` 源目录、直接调用 tar 命令构造器，模拟的正是修复前运行时的行为。新的防护位于运行时探测（不创建源、拒绝空源镜像），由 `mirror-source-guard.test.ts` 端到端验证。

| 检查 | 结果 |
| --- | --- |
| `npm run typecheck` | 通过 |
| `npm run lint`（max-warnings=0） | 通过 |
| 全量 Vitest（`RUN_DATABASE_INTEGRATION_TESTS=1`，一次性库） | 通过：810 个测试文件；6449 passed，3 skipped，0 failed；耗时 621 秒 |
| `npm run route:verify` | 通过：56 pages、189 API routes、52 permissions |
| `npm run docs:check` | 通过（README 指标已随新增组件更新） |
| `npm run i18n:key-check` | 通过：缺失 0，中英不一致 0 |
| `npm run api-copy:audit` | 通过：0 项新增硬编码英文 |
| `npm run rbac:audit -- --no-write` | 通过：0 漂移 |
| `prisma format --check` / 迁移漂移 | 通过 / 无漂移 |
| `npm run build`（Next 生产构建，在本工作区以低优先级运行，未触碰运行中的服务目录） | 通过 |
| `npm run build:runtime` | 通过 |

每个修复的“修复前失败、修复后通过”记录保存在 `/tmp/claude-audit-work/r*-before.log`。方法是临时把被测文件换回修复前版本运行同一测试，再恢复修复版本；该替换从未提交。

**全量测试**：第一次全量运行出现 5 项失败。其中 4 项是运行期间源文件被修改（同时提交了文案本地化）造成的不一致。另 1 项是真实问题：R03 的互斥集成测试早于 R04 的排空步骤，mock 缺少 `job/syncJob`，已在 `bc0771b5` 修复。修复后在不做任何改动的情况下完整重跑，结果全部通过（见上表）。

**未运行**：
- `npm run audit:high`：需联网查询 npm 漏洞库。
- E2E/Playwright：需要完整登录态环境与浏览器。
- 真实 VPS/Docker/SMTP/Webhook。
- 真实数据库恢复演练。
- k6 容量测试。

## 6. 剩余事项（未标为已修复）

1. **R04**：恢复期间的交互式 API 写入仅受数据库事务的表锁阻塞，未实现全站维护模式（需决定是否对所有写接口返回 503）。没有“精确还原”文件模式和差异预览。没有影子库切换与恢复后自动业务探针。恢复与 `deploy.sh` 升级之间没有互斥矩阵。
2. **R01**：没有源挂载身份标记和删除比例阈值。
3. **R05**：没有步骤级幂等声明或人工确认，取消确认后的非幂等重试仍按配置进行。
4. **R07**：没有应用层就绪探针、镜像 digest 和数据卷恢复点。
5. **R08**：没有逐收件人投递追踪；升级通知的失败重试未纳入。
6. **R11**：媒体详情页上一项/下一项仍限前 200 条。
7. **R13**：全文/向量检索、中文分词、召回评测集。
8. **R14**：缺样原因（采样器/主机/应用）区分需在采样与 rollup 中新增字段。
9. **R15**：容量基线需要在隔离环境用真实负载测量。
10. **CI 外部条件**：GitHub 分支保护仍需仓库管理员在 Settings 中开启（见 `docs/ci-gates.md`）。

## 7. 提交对应关系

| 提交 | 内容 |
| --- | --- |
| `80d06d05` | R02 tar 暂存接收与全阶段状态检查 |
| `9f68e319` | R01 不自动创建源、拒绝空源镜像覆盖 |
| `1c35d1d5` | R03 平台级恢复锁 + 主机级 CLI 锁 |
| `b0de217e` | R04 单事务恢复、DB 先于文件、后台停写排空、失败标注与历史 |
| `958c54f4` | R02 镜像提交阶段可恢复 |
| `2d3c4c10` | R05 取消确认屏障 |
| `4540ced5` | R06 保存认领 occurrence（迁移） |
| `ed7bdf60` | R07 不破坏旧容器、验收运行状态 |
| `8b291872` | R08 失败渠道补投（迁移） |
| `cf1af656` | R09 Hub 快捷应用搜索范围 |
| `c80b8b89` | R10 分享分页/筛选 |
| `a00ddec6` | R11 媒体分页与数据库计数 |
| `e5fa6201` | R12 任务中心筛选下推 |
| `24b7c0a1` | R13 知识库相关度召回 |
| `84442ef3` | R14 可用率采样覆盖 |
| `14ecfd3b` | R15 k6 入口路径 |
| `2e756b93` | R16 RBAC 门禁接入 CI |
| `1d7f6229` | R07 新增错误文案本地化（api-copy 门禁） |
| `eb1f65cd` | README 指标更新（docs:check 门禁） |
| `bc0771b5` | R04 后续：恢复互斥集成测试补充排空查询的 mock |
