# 2026-10-12 审查结论核验与修复记录

本文记录对《VControlHub 全面审查报告》（2026-10-12，基准 `b27f9b90`）R01～R16 的独立核验、修复与验证，以及第二轮只读审查交接的 S01～S09（含用户报告的 SSH 终端非全屏错位）、第三轮复核的 S10 与 R05/R08/S03/S04/S05 补充修复。面向没有参与讨论的维护者：每项都给出结论分类、当前源码依据、触发条件与风险界限、修复方式、回归证据和对应提交。

- 工作分支：`fix/verified-audit-20261012`；起点 `8e8980cd`（已含 PR #30 知识库提示隔离、PR #31 UI 修复）。
- 核验以起点源码为准，不以报告中的历史快照为准。下文的“依据”行号均指 `8e8980cd`。
- PR #30 已修复的“知识库片段注入 system 消息”问题按报告说明排除，本次未改动。
- 所有验证都在独立工作区和一次性测试数据库中进行（见第 5 节）；没有部署、没有重启服务、没有连接生产数据库或真实 VPS，也没有对外发送通知。唯一越界是测试在本机数据目录写入了 4 个测试版本文件，已删除并修正测试默认值（见第 5 节“测试数据目录事件”）。

## 1. 结论速览

分类含义：**confirmed** 当前代码中缺陷真实存在；**partially-confirmed** 报告描述部分成立，或部分属于设计取舍；**false-positive** 不成立；**already-fixed** 起点前已修复。R01～R16 与 S01～S09 中没有 false-positive，也没有 already-fixed；S09 的一个前提（“普通 SFTP 存储读取已有 realpath 校验”）不成立，见该节。

| 编号 | 分类 | 一句话结论 | 修复状态 | 提交 |
| --- | --- | --- | --- | --- |
| R01 | confirmed | 同步前对源目录 `mkdir -p`，MIRROR/删除孤立项会把“源缺失”变成“清空目标” | 已修复 | `9f68e319` |
| R02 | confirmed | tar 回退只看管道末端退出码；镜像模式先清空目标再解包 | 已修复（含提交阶段可恢复） | `80d06d05`、`958c54f4` |
| R03 | confirmed | 恢复锁按 backupId 加，不同备份可并发恢复同一目标 | 已修复（应用内恢复已取消，主机级锁保留） | `1c35d1d5`、`4b5f1b78` |
| R04 | partially-confirmed | SQL 非单事务、FULL 先文件后库、恢复期间平台照常写入；文件“覆盖合并”是语义而非缺陷 | 已修复：恢复改为仅离线执行，由恢复脚本检查前提；检查是时间点检查，边界见该节 | `b0de217e`、`4b5f1b78`、`c0d4a97c` |
| R05 | confirmed | Playbook 超时后发出取消即重试，旧命令仍在 CANCELLING；取消结束为结果未知、数据库读写异常时仍会重试 | 已修复 | `2d3c4c10`、`a35e1908`、`de1a6caf` |
| R06 | confirmed | 定时任务认领用 +24h 哨兵覆盖 nextRunAt，崩溃后跳过一天并丢失原 occurrence 幂等键 | 已修复（含迁移） | `4540ced5` |
| R07 | confirmed | 快捷应用重建：inspect 任意错误当“不存在”、rename 失败退化为 `rm -f`、不验收运行状态、start 大范围 catch | 已修复 | `ed7bdf60`、`1d7f6229` |
| R08 | confirmed | 告警首次投递失败的渠道，事件持续 OPEN 时不再补投；创建后发送前崩溃或记账失败时同样永不补投 | 已修复（含迁移；至少一次） | `8b291872`、`eef6fa9d` |
| R09 | confirmed | 搜索对任意 docker:manage 持有者返回 Hub 主机快捷应用元数据 | 已修复 | `cf1af656` |
| R10 | confirmed | 分享列表固定 200 条，无分页/搜索 | 已修复 | `c80b8b89` |
| R11 | confirmed | 媒体列表固定 200 条，收藏数只算当前批次；详情页上一项/下一项只在前 200 条内 | 已修复 | `a00ddec6`、`f0779e41` |
| R12 | confirmed | 任务中心先按来源截断再按状态/类型筛选 | 已修复 | `e5fa6201` |
| R13 | confirmed | 知识库候选先按时间取 200 再算相关度 | 已修复召回排序；向量/全文检索不在本次范围 | `24b7c0a1` |
| R14 | confirmed | 可用率只表达已采样成功比例，不显示采样覆盖 | 已修复展示层；“采样器故障/主机不可达”区分列为剩余 | `84442ef3` |
| R15 | confirmed | k6 包装脚本 ROOT 指向 scripts/，路径变成 scripts/scripts/… | 已修复（仅入口，未做容量压测） | `14ecfd3b` |
| R16 | confirmed | RBAC 审计无条件 exit 0，且不在 CI 中 | 已修复并接入 CI | `2e756b93` |

| 编号 | 分类 | 一句话结论 | 修复状态 | 提交 |
| --- | --- | --- | --- | --- |
| S01 | confirmed | SSH 终端非全屏时网格高于可见区域、底部行被裁；PTY 停在 80x24；sm～lg 宽度下固定最小高度仍溢出 | 已修复，真实浏览器三内核验证 | `4b1b580f`、`9360a015` |
| S02 | confirmed | 版本恢复不检查单文件上限与配额；覆盖写重复计入原文件大小 | 已修复 | `6a36c32c` |
| S03 | confirmed | ITSM 入站首次失败后，同一外部事件的重试永远返回旧错误；业务写入与 applied 标记分离，标记写失败后重试会重复业务 | 已修复 | `91696492`、`e3238528` |
| S04 | confirmed | 下载取消：无 pid 时不处理远端、只杀父 shell 留下 curl、结果未检查、PENDING→RUNNING 竞态；“未找到进程”的取消可被随后落地的启动超越 | 已修复 | `da68b3d9`、`cb3d26de` |
| S05 | confirmed | Agent 超时读到 PENDING 后被领取仍走 SSH 回退；租约过期伪造完成 | 已修复（含迁移；Playbook 侧补充见 R05） | `a040b676` |
| S06 | confirmed | VPS 备份计划 2099 哨兵、平台备份计划 24h 哨兵，认领后崩溃即永久/一天漏执行 | 已修复 | `a5bec026` |
| S07 | confirmed | 部署回滚：命令创建前后崩溃使回滚永久阻塞；关联失败标 FAILED 后可重复下发 | 已修复 | `83d858ac` |
| S08 | confirmed | WebDAV 覆盖 MOVE 必撞唯一索引；MOVE/COPY 覆盖回收站文件字节；目录 MOVE 一律 500 | 已修复 | `1b567234` |
| S09 | confirmed（前提部分不成立） | LOCAL 默认全节点内容搜索恒为 0；SFTP 以符号链接为起点可搜到根外内容 | 已修复；普通 SFTP 存储读写的同类问题由 S10 修复 | `eb50150e`、`1362653f` |
| S10 | confirmed | SFTP 存储节点所有读写只做词法包含，存储根内的符号链接可读写根外任意 SSH 账号可达路径；同根内跨授权前缀的链接可绕过路径授权（LOCAL 同样） | 已修复；远端并发换链的 TOCTOU 边界见该节 | `1362653f` |

另有：文档提交 `eb1f65cd`（README 指标，`docs:check` 门禁要求）、报告提交 `7bc5fa83`，以及测试环境修正 `2dab5fe4`（见第 5 节“测试数据目录事件”）。

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
- **修复**：
  - 第一版（`1c35d1d5`）把应用内恢复改为平台唯一锁，并给 `restore.mjs` 与 `restore-files.sh` 增加主机级锁 `APP_DIR/.restore.lock`（mkdir 原子创建，记录 pid/host；同机已死进程留下的锁可回收，活着的持有者绝不被替换）。
  - R04 改为仅离线恢复后（`4b5f1b78`），应用内已不再执行恢复，应用内锁随之删除。现在 `restore-db.sh`、`restore-files.sh`、`restore-full.sh` 都转交 `restore.mjs`，所有组件都持有同一个主机级锁。
- **证据**：`scripts/__tests__/restore-runner.test.ts` 分别覆盖 node 与 bash 入口的活锁拒绝（不写入任何文件、不删除对方的锁）和死锁回收。
- **界限**：主机级锁只在同一安装目录内互斥；恢复与 `deploy.sh` 升级之间没有互斥矩阵（见第 6 节）。

### R04 在线恢复缺少停写与一致性 — partially-confirmed

- **依据**：`scripts/restore.mjs:61` 仅用 `-v ON_ERROR_STOP=1` 导入，无单事务；`:235` FULL 先恢复文件再导入数据库；恢复期间 Worker、API、Agent 回报、计划任务和终端会话照常写入。
- **成立的部分**：SQL 中途失败时之前的 DROP/CREATE/COPY 已提交，得到半恢复的数据库；FULL 中数据库失败会留下“新文件 + 旧库”；平台在数据被替换期间写回旧状态。
- **不认定为缺陷的部分**：`restore-files.sh` 的 `cp -a`/Node `fs.cp` 是覆盖合并（备份后新增的文件保留），这是一种恢复语义，不是错误。本次在文档中明确说明，未新增“精确还原”模式。
- **第一版及其问题**（`b0de217e`）：单事务导入、FULL 先库后文件仍然保留。但其“在线停写”有缺陷，监督复核后在真实 PostgreSQL 上复现：
  - `claimNextJob`/同步启动前的 `pg_locks` 探测是先检查后执行，Worker 可在恢复取得锁之前通过检查、在排空看到空队列之后才领取；
  - 只排空 Job/SyncJob 不等于平台静止，API 写入、Agent 回报、计划任务、终端会话不受控；
  - 表锁只覆盖数据库事务，不覆盖 FULL 的文件阶段。

  因此第一版不能作为安全保证。
- **当前设计：恢复只能离线执行**（`4b5f1b78`，`c0d4a97c`）：
  1. 应用不再执行任何恢复。`POST /api/backups/:id/restore` 只核对备份状态与 SHA-256，返回离线步骤：停止服务 → 恢复前安全快照 → 带 `CONFIRM_RESTORE=1` 的恢复命令 → 启动服务。备份页以对话框展示，并审计为 `backup.restore_plan`。旧版本排入的恢复任务以永久错误结束，不会执行。在线停写的门（`restore-gate.ts`、领取/同步检查、排空）已删除。
  2. `scripts/restore.mjs`（三个 `.sh` 入口都转交它）检查前提：
     - 每个组件都要求 `CONFIRM_RESTORE=1`；
     - 平台 systemd 服务（默认 `vcontrolhub-next`、`vcontrolhub-worker`、`vcontrolhub-ssh-ws`，`VCONTROLHUB_SERVICE_UNITS` 可改）必须被确认已停止：读取 `LoadState`/`ActiveState`，只有 loaded/masked 且为 inactive/failed 才通过。运行中、过渡态、unknown、服务名不存在（多为自定义服务名）、`systemctl` 出错或不存在都拒绝。非 systemd 部署须在自行停止全部实例后显式设置 `VCONTROLHUB_SERVICE_UNITS=none`，脚本记录这一确认；Windows 的恢复命令已带此设置。
     - 数据库导入（`psql -X -v ON_ERROR_STOP=1 --single-transaction -f -`）的第一条语句检查 `pg_stat_activity`，还有其他客户端连接目标库则整个事务放弃；FULL/仅文件在复制文件前再检查一次服务与数据库连接。
     - FULL `all`：先解压并校验文件到暂存区，再执行数据库事务，提交后才复制文件。数据库失败时数据库与文件都不变；文件复制失败（数据库已提交）时明确报告 `PARTIAL RESTORE`。
     - 结果追加到归档旁的 `restore-history.jsonl`。
  3. **边界（必须由运维保证）**：上述都是时间点检查，不是隔离。检查之后才启动或连接的实例不会被拦住，例如其他主机上的实例、未列入的自定义服务、手工启动的进程。导入事务的表锁只覆盖已处理到的表，文件阶段没有任何隔离。所以从停止服务到恢复完成，所有实例必须一直保持停止；用户指南 13.4 和恢复对话框都写明了这一点。第一版提交说明 `4b5f1b78` 中“该检查不会被并发绕过”的表述过强，已由 `c0d4a97c` 在代码注释、文档和界面中更正。
- **证据**：
  - `restore-atomicity.integration.test.ts`（真实 PostgreSQL，各自的临时库）：存在其他连接时导入拒绝且数据不变（旧脚本照常恢复）；dump 在数据语句之后失败时数据库与文件都保持原样；FULL 数据库失败时文件不变；真实应用 schema 单事务恢复成功。
  - `scripts/__tests__/restore-runner.test.ts`、`restore-files.test.ts`（伪 systemctl/psql）：服务运行、过渡态、unknown、not-found、systemctl 出错、空服务列表时都拒绝且不写入目标；其中 4 种在 `c0d4a97c` 之前的脚本下照常恢复。`none` 确认可以恢复，但仍会因数据库连接而拒绝。node 与 bash 入口都覆盖。
  - service、route、job-worker 与对话框测试覆盖离线步骤与旧任务的终止。
- **剩余**：没有全站维护模式、影子库切换、恢复后自动业务探针、“精确还原”文件模式，也没有恢复与 `deploy.sh` 的互斥矩阵。

### R05 Playbook 取消确认屏障 — confirmed

- **依据**：`src/lib/playbook/executor.ts:113` 超时调用 `cancelCommandRequest` 后立即抛错；`:380` 重试回调删除当前步骤记录，下一次尝试用新幂等键创建命令；取消运行中的命令只会进入 CANCELLING（`service-requests.ts:322`）。
- **修复**：发出取消后最多等待 60 秒（继续心跳），直到旧请求进入终态：非 COMPLETED 终态按普通超时处理、允许重试；取消过程中实际 COMPLETED 的按成功处理；始终未终止则抛出 `CommandOutcomeUnknownError`，步骤失败且不再重试。
- **证据**：`executor-cancel-barrier.test.ts`（假时钟）。旧请求卡在 CANCELLING 时，修复前创建了 3 个重叠的命令请求，修复后只有 1 个。
- **补充修复（复核发现）**：
  - `a35e1908`：取消等待后的 FAILED/CANCELLED 终态原先直接抛出可重试的普通错误。现实序列是超时 → CANCELLING → Agent 不确认 → FAILED 且目标 `outcomeUnknown`，这会再建下一次尝试的命令。另外，回收（reclaim）时会丢弃“结果未知”的旧请求 id 再新建。现在所有非 COMPLETED 终态（普通等待、取消等待、回收时发现已终态）都先检查结果未知。
  - `de1a6caf`：异常路径。未知计数查询、状态轮询或命令创建后的进度写入失败时会抛出普通错误；`createCommandRequest` 也可能在已写入后才抛错。之后重试回调删除旧 id 并新建命令。现在重试前有统一的失败关闭闸门：收集失败尝试可能创建的全部命令（结果中的 id，以及按该尝试幂等键查到的请求）。只有全部为“非 COMPLETED 的终态且结果已知”时才允许重试；仍在运行、已完成（步骤之后才失败）、不存在或状态读不到时，都停止该步骤。
  - 证据：`executor-cancel-barrier.test.ts`。取消后 FAILED/CANCELLED 且未确认、回收时遇到未知结果、计数/状态读/进度写/创建后抛错、闸门读失败、已完成后失败，共 9 例在修复前失败；普通失败仍然重试。
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
- **补充修复**（`eef6fa9d`，复核发现）：
  - 问题：待投递渠道原先只在发送之后尽力写入。以下两种情况都会留下 `pendingNotifyChannels=[]`、`nextNotifyAt=null` 的 OPEN 事件，从此不再补投：进程在创建/重开事件后、发送前或发送中退出；投递失败后记账写入也失败。重开时还会保留上一轮的投递字段，例如次数已到上限。
  - 修复：创建与两条重开路径现在与事件一起写入投递意图：全部配置渠道待投递、第 1 次尝试、以重试时间作为租约，并替换上一轮的状态。发送后的记账照常清除已送达渠道；若记账没有发生，到期后的评估会再次发送全部待投递渠道。这是至少一次语义：崩溃或记账失败前已送达的渠道可能收到两次触发通知。没有引入逐收件人 outbox 或新的通知功能。
  - 证据：同一测试文件新增 3 例，修复前全部失败：发送前进程退出后，之后的评估通知全部渠道；webhook 失败且记账失败后仍会补投（邮件重复一次，至少一次）；重开一个上一轮已用尽次数的已解决事件并在发送前退出，状态被重置，随后送达。
- **界限**：同一渠道内只要任一收件人成功即视为送达，未做逐收件人追踪；升级通知的失败重试未纳入本机制；补投为至少一次，可能重复。
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
- **详情页导航**（`f0779e41`）：详情页原先取同类型前 200 条再查当前项，第 200 条之后的项目没有上一项/下一项，且忽略用户来自哪个列表。现在 `getMediaNeighbors` 按列表自身的顺序（收藏、updatedAt、id 降序）和筛选条件（类型、搜索、收藏、标签，从 `from` 链接解析），用 keyset 查询相邻项；卡片带上当前列表链接（含筛选与页码），“返回”回到同一页。
- **证据**：`media-pagination.integration.test.ts`（450 条相同 updatedAt：逐页不重不漏、数据库计数、从第一项连续“下一项”走完全部 450 条且顺序与分页一致、页边界与两端、筛选列表内导航）；`media/__tests__/page.test.tsx`（5000 条中第 3 页、收藏数来自数据库、分页链接）与卡片测试（携带列表链接）。

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

## 2b. 第二轮审查 S01～S09

“修复前失败”的方法与 R 系列相同：临时把被测文件换回修复前版本运行同一测试，再恢复修复版本，替换从未提交。

### S01 SSH 终端非全屏文字错位（用户报告）— confirmed

- **复现**：真实浏览器实验环境（自定义服务器 + 真实 ssh-ws-proxy + 按 PTY 尺寸绘制标尺与末行标记的进程内 SSH 服务器），Chromium/Firefox/WebKit。1366x768 普通窗口：屏上网格 117x21，但远端 shell 为 80x24；可见裁剪高度 289px 而网格 336px，末尾约 3 行（提示符与光标）在对话框可见区之外。全屏时两个问题都被掩盖。
- **根因**：
  1. 布局：桌面普通对话框为 `h-auto` + `max-h-[72vh]`，终端表面却保留 `lg:min-h-[350px]`，FitAddon 按表面而非可见区计算网格。1px 边框在 border-box 宿主上也被算作可用空间。
  2. PTY 尺寸：浏览器在 SSH 认证完成前发送尺寸，代理因 shell 尚未建立而丢弃，shell 以 ssh2 默认 80x24 打开。
  3. 监督复核发现的 sm～lg 宽度问题：对话框从 sm 起已是 72vh，而表面框架直到 lg 才取消 `min-h-[280px]`。900x600 初始状态末行仍在可见区外（已在实验环境复现）。
- **修复**：
  - 对话框高度确定，表面在宽屏下恰好占满剩余空间；边框移到外层框架。
  - 代理保存最后请求的窗口尺寸，以该尺寸打开 shell（建立过程中到达的尺寸也会应用）；客户端在 `connected` 时再发送一次。
  - 280px 的固定最小高度只在 lg 以下、侧栏或文件管理器叠在终端下方时启用（此时列可滚动，是有意的布局）。其他情况表面恰好占满剩余空间。
- **证据**：`e2e/ssh-terminal-layout.spec.ts`（需显式开启 `E2E_SSH_LAYOUT_LAB=1`）。覆盖 1366x768、1920x1080、900x600、768x600、1280x520、390x844，每个尺寸都检查初始、全屏、退出全屏、缩小与还原窗口、最小化后恢复；要求末行在可见裁剪区内，且 PTY 等于屏上网格。三内核全部通过；旧代码在“1366x768 initial”失败，`9360a015` 之前在“900x600 initial”失败。另有 `ssh-ws-proxy-session.test.ts` 覆盖认证前到达的尺寸。

### S02 存储配额：版本恢复绕过、覆盖写重复计费 — confirmed

- **依据**：`file-versions.ts` 的 `restoreFileVersion` 经 `resolveAccessibleFileEntry` 授权写入，但不传 `writeBytes`，而 `access-control.ts` 只在有 `writeBytes` 时检查 `maxFileBytes`/`quotaBytes`。另外配额判断为 `已用 + writeBytes`，已用量里已经包含被覆盖文件的大小。
- **影响**：管理员降低额度后，成员可恢复更大的旧版本绕过限制；额度已满时，同大小或更小的改写（文本编辑、续传、WebDAV PUT、复制覆盖）也被拒绝。
- **修复**：
  - 恢复以版本字节数作为写入检查，并持有配额锁直到索引更新。
  - `assertStorageAccess` 在配额锁内减去被替换的现存文件大小（新文件或目录目标为 0），所有调用方统一按增量计费。
  - 语义写在函数注释中：授权额度约束的是其路径前缀下全部现存文件字节，不分写入者；对同一目录有授权的不同用户共享其中的存量，各自按自己的授权衡量。
- **证据**：`quota-overwrite.integration.test.ts`（真实 PostgreSQL + 真实本地目录）：超过新单文件上限或配额的版本恢复被拒且文件不变，合规恢复生效；满额时同大小/更小覆盖允许，增长和新文件被拒。旧代码 3 例全部失败。
- **剩余**：解压、压缩、SFTP 同步、远端下载、跨授权移动等事先不知道大小的写入仍没有按字节准入。

### S03 ITSM 入站失败被当作永久去重 — confirmed

- **依据**：`service-inbound.ts` 在外部事件锁内按 externalId `findFirst`，不看状态就返回已有事件；catch 又以同一 externalId 记录 `status:error`。唯一索引只允许一行。
- **影响**：createTicket 短暂失败后，发送方的重试永远收到旧错误，工单不会创建。路由把该事件映射为非 ok，不会误报 200 成功。
- **修复**：
  - 处理前先认领事件行：ok/ignored 是真正的重复，error/pending 行被复用并重新处理。
  - 补充（`e3238528`）：原先 `applied` 标记在业务写入之后单独写入。不只进程被杀，标记写入本身失败（数据库错误、连接中断）也会造成“业务已提交而标记仍为 false”，重试会再建一张工单、重复评论，或状态迁移从此一直失败。现在 `createTicket`、`addTicketComment`、`updateTicketStatus` 可接收事务客户端（仅允许与 `skipItsmFanOut` 一起使用，外发不得在事务内执行），入站处理在同一个事务内完成业务写入与 `applied` 标记，两者同时提交或都不提交。入站调用本来就跳过外发，业务写入之后没有其他外部副作用。之后的记账失败只会让重试补完记录。
- **证据**：
  - `itsm/__tests__/service.test.ts`（有状态事件存储）：首次失败后重试只建一张工单。
  - `inbound-atomicity.integration.test.ts`（真实 PostgreSQL）：用触发器在数据库内拒绝本测试连接的 applied 标记写入，即业务写入之后的第二次写入失败。建工单、评论、改状态三种情况下，失败的尝试都不留下任何改动，重试恰好生效一次。修复前 3 例全部失败（业务已提交）。

### S04 下载取消报告已取消但远端仍在执行 — confirmed

- **依据**（`api/downloads/route-delete.ts`、`downloads/remote-command.ts`）：
  - RUNNING 直连任务没有数据库 pid 时，直接标记 CANCELLED，不处理远端；
  - 有 pid 时执行 `kill PID; rm -f marker`，退出码被 rm 覆盖，且调用方也不检查；
  - PID 是 `nohup bash`：bash 收到 SIGTERM 退出，但前台 curl 不会收到信号；
  - 取消读到 PENDING 后，Worker 领取并启动，取消的 CAS（PENDING|RUNNING）仍成功，Worker 记录 pid 的更新静默落空。
- **复现**：真实 bash + curl + 本地慢速 HTTP 服务器，旧取消命令执行后 curl 仍在运行。
- **修复**：
  - `buildDirectDownloadStopCommand` 以任务唯一的暂存后缀 `.vch-<task>.part` 识别进程（bash 脚本与 curl 的 `-o` 参数都含它）：不依赖 pid，能找到孤儿 curl，不会误杀复用了 pid 的无关进程。模式在运行时拼接，命令自身的 shell 不会匹配。命令先 TERM、再 KILL，然后复查，并清理暂存文件与标记；只有确认没有残留时才以 0 退出。
  - 路由对 RUNNING 直连任务总是执行停止，确认后才标记取消；否则返回 502 且保持 RUNNING，可以再次取消，对账器也会继续探测。PENDING 用只针对 PENDING 的 CAS 取消；若 Worker 抢先领取，则按运行中任务处理。
  - Worker 记录 pid 时若发现任务已不在 RUNNING，就停止自己刚启动的进程；其失败清理也用同一停止命令。
  - 补充（`cb3d26de`）：复核记录的窗口已用真实进程复现。取消找不到进程（NOT_RUNNING）后任务变为 CANCELLED，正在途中的启动随后落地，而 Worker 在记录 pid 前死亡，于是 curl 在 CANCELLED 任务下运行。现在用户取消先在服务器写入任务专属的墓碑文件，再查找进程；下载脚本记录 pid 后立即检查墓碑，存在则在 curl 之前退出。墓碑写入前已开始的启动，其命令行从一开始就带标识，会被 pgrep 找到；之后开始的启动会自行退出。墓碑写不进去时取消不算确认（502，保持 RUNNING）。直连任务不会以同一 id 重新排队，墓碑不会挡住正常运行。
- **证据**：`remote-stop.process.test.ts`（真实进程）：无进程残留、无暂存文件，无 pid 标记也能找到，能停止孤儿 curl，不碰持有标记 pid 的无关进程；“未找到进程”的取消之后落地的启动不会运行 curl（修复前 curl 在运行）。路由/Worker 测试覆盖无 pid、未确认、PENDING 竞态和启动期间取消，5 例在旧代码下失败。

### S05 Agent 超时/租约过期伪造完成 — confirmed

- **依据**：`server/agent-service.ts`：
  - 超时分支读到 PENDING 后，用 `status in (PENDING, CLAIMED)` 写 CANCELLED + completedAt。Agent 若在两步之间领取，旧的 PENDING 读取仍返回 null，调用方再经 SSH 执行同一命令。
  - 租约过期同样写入完成；租约过期只说明心跳停了，不代表远端已停止。
- **修复**：
  - 只有原子的 PENDING→CANCELLED（证明从未派发）才允许返回 null 回退 SSH。
  - 已领取的任务改为“请求取消”（completedAt 为空）并等待 Agent 自己的报告；等不到则抛出 `CommandCancellationUnconfirmedError`，既不伪造结果也不回退。
  - 租约过期同样只记录取消请求，Agent 迟到的结果仍会记录。
  - 新增 `CommandTarget.outcomeUnknown`。Playbook 对结果未知的命令不再重试（`CommandOutcomeUnknownError`），普通失败照常重试。
- **证据**：`agent-timeout-race.test.ts`（执行条件更新的有状态任务存储），旧代码 4 例中 3 例失败；另有 service-execution 与 executor-cancel-barrier 测试。
- **迁移**：`20261013090000_command_target_outcome_unknown`。

### S06 两种备份计划的哨兵崩溃窗口 — confirmed

- **依据**：
  - `vps-backup-schedule-service.ts` 认领时把 nextRunAt 写成 2099-01-01，之后才创建记录、入队、推进 cron；
  - `schedule-worker.ts` 写 now+24h 哨兵后再派发；
  - 进程在认领后退出时，前者永久停止调度，后者静默跳过一天。
- **修复**：两者都在一个数据库事务内完成认领（对观察到的 nextRunAt 做 CAS，直接推进到下一个 cron 时间）、PENDING 记录、持久任务与运行记账。中途崩溃什么都不提交，occurrence 保持到期；并发 tick 仍只派发一次。VPS 的重叠跳过也在同一事务内。
- **同类排查**：Playbook cron 触发器已是同事务认领入队；定时任务已由 R06 修复；同步计划由 lastSyncAt 推导，没有哨兵。
- **证据**：`schedule-crash-recovery.integration.test.ts`（真实 PostgreSQL）在最后一次写入（入队）处注入崩溃，并抑制调用方的失败记账，模拟被杀的进程。两种计划都保持到期、没有任何产物；随后两个并发重试只派发一次。VPS 用例在旧代码下得到 nextRunAt = 2099-01-01。

### S07 部署回滚落库与命令创建的崩溃窗口 — confirmed

- **依据**：`deployment/service.ts` 的 `createDeploymentRollbackRun` 先建 PENDING 回滚，再 `createCommandRequest`（无幂等键），最后关联。没有任何对账器处理 commandRequestId 为空的回滚（`refreshDeploymentRollbackStatuses` 只处理已关联的）。
- **影响**：任一步之间崩溃，留下的 PENDING 回滚使该部署之后的回滚永远被拒绝；命令已创建但关联失败时，catch 把回滚标为 FAILED，命令却仍可被批准执行，下一次回滚再下发一条相同命令。
- **修复**：
  - 命令带稳定幂等键 `deployment-rollback:<rollbackId>`。
  - `recoverUnlinkedRollback` 按该键恢复：命令存在则关联并取其状态（已结束则关闭）；不存在说明从未下发，标为 FAILED。
  - 回滚请求在既有的按源部署 advisory 锁（会话级锁，持有者进程死亡即释放，因此锁内不会有正在创建的请求）内，对所有未关联的活动回滚先执行恢复，再判断冲突。
  - 失败路径也用同一恢复，不再盲目标 FAILED；恢复本身失败时保持 PENDING，由下一次请求恢复。
- **证据**：`deployment/__tests__/service.test.ts`（有状态存储）覆盖 4 种情况，旧代码下 4 例全部失败：命令创建前崩溃后可再次回滚；关联失败既不标 FAILED，也不下发第二条命令；创建与关联之间崩溃后，由下一次请求完成关联；命令已结束的未关联回滚被关闭。

### S08 WebDAV MOVE/COPY/PUT 与回收站、唯一索引 — confirmed

- **依据**：`webdav/handler.ts`。唯一索引 `(storageNodeId, relativePath)` 包含软删除行；文件管理器删除只改索引，回收站文件的字节仍在原路径。
- **真实环境复现**（真实临时目录 + 真实 PostgreSQL）：
  - 覆盖 MOVE 原地把旧行标为删除（路径未让出），索引更新必撞唯一约束，返回 500；
  - MOVE/COPY 到回收站文件：先改写字节再撞唯一约束，回滚后回收站字节丢失；
  - 任何带子项的目录 MOVE 都返回 500：`substring(... FROM $n)` 的参数未声明类型，PostgreSQL 选了正则形式，返回 NULL，违反 name 非空约束；
  - PUT 覆盖回收站文件时不留版本，且不清除 deleteBatchId。mock 测试暴露不了这些问题。
  - 核对审查说明：PUT 本身不会撞唯一约束（它另外按唯一键查找）；核心问题是覆盖 MOVE 和回收站字节保护。
- **修复**：
  - 目标处（或其下）仍有回收站字节时，MOVE/COPY 在改动字节前返回 409；
  - 占用目标路径的行（被覆盖的现存行、字节已不存在的回收站行）在同一事务内移到唯一的墓碑路径并软删除，让出路径、保留历史；
  - 目录改写用 `::int` 并连同回收站子项一起移动；
  - PUT 覆盖回收站文件时先把其字节存为版本（不能存则拒绝），并清除 deleteBatchId。
- **证据**：`move-copy-recycle.integration.test.ts` 8 例：Overwrite:T/F、目录移到新路径与覆盖现存目录、回收站文件与子项拒绝且字节完好、COPY 拒绝、PUT 版本与批次清除。原始 7 例中 6 例在旧代码下失败，其中 2 例回收站字节被毁。

### S09 内容搜索默认根目录与 SFTP 边界 — confirmed（前提部分不成立）

- **LOCAL**：默认不带路径。`searchLocalNode` 把空串交给 `resolveLocalAbsolutePath`，它面向文件目标，拒绝空路径；外层 catch 只记日志，所以 LOCAL 节点的全节点内容搜索恒为 0。现在无路径即节点根，子路径保留原有的词法与符号链接包含检查。
- **SFTP**：远端路径只做拼接和 “..” 拒绝。grep 会跟随作为起点的符号链接，`searchPath=<指向根外的链接>` 能返回根外文本。现在远端命令先在同一 shell 中比较搜索路径与节点根的物理路径（`cd -P`/`pwd -P`），超出则以 3 退出；节点根本身是链接时仍可用。`grep -r` 递归时不跟随起点以下的链接。
- **不成立的前提**：审查说明认为普通 SFTP 存储读取已有远端 realpath 包含校验，实际没有。`readStorageFileBuffer`/`streamStorageFile` 对 SFTP 只做词法包含，`sftp.readFile` 会跟随链接。这一问题后来作为 S10 修复；搜索也改用 S10 的同一规则（物理位置必须正好是“节点根 + 请求路径”）。
- **证据**：`content-search.process.test.ts`（真实临时目录与符号链接；SFTP 生成的远端命令由本机 sh 执行，代替 SSH）：LOCAL 默认搜索能找到文件（旧代码返回 []）；经链接的 SFTP 搜索不返回根外内容（旧代码返回根外文件内容）；子路径与链接根仍可用。

### S10 SFTP 存储节点的物理路径包含 — confirmed（第三轮复核）

- **依据**：所有 SFTP 存储路径只经过 `normalizeRemoteTargetPath` 的词法包含。存储节点背后的 SSH 账号通常能访问远多于 basePath 的范围，而 SFTP 与 Agent 都会跟随符号链接。所以存储根内任何指向外部的链接（在主机上创建，例如 `docs/out -> /etc`），都让任何有该节点文件权限的用户能读、写、改名、删除外部内容。服务器 SFTP 浏览器的 `assertSftpPathAccess` 不保护存储节点。另外，同根内指向兄弟目录的链接（`a/sib -> ../b`）可以绕过按词法路径匹配的路径授权，LOCAL 节点也有同样问题。
- **复现**：真实文件与真实链接，直连 SSH 与 Agent 两种方式下，旧代码都返回了根外文件的字节。
- **规则与修复**：
  - 规则：路径的规范（无链接）位置必须等于“节点根的规范位置 + 词法相对路径”。节点根本身可以是链接；根以下不跟随任何链接跳转。
  - `remote-containment.ts`：用 `resolveRemoteRealPath` 解析根与目标。直连时走 SFTP realpath，路径不存在时逐级向上解析已存在的祖先，悬空链接拒绝；Agent 走 python realpath。调用方随后使用规范路径操作。
  - 覆盖全部 SFTP 存储入口：
    - `fs-backend` 的建目录、写入（含父目录）、读、stat、删除、改名（两端）；
    - `file-content` 的读、流式读、写、暂存移入、删除、复制；
    - 复制列表、回收站恢复检查、索引同步起点；
    - 分享、目录打包下载、sftp 列表/下载/操作（在改动索引之前检查）、本地上传到 SFTP、媒体流与缩略图等路由。
  - 直连网关 URL 已由网关自身做 realpath 包含；tar 归档把链接存为链接；解压与压缩只支持 LOCAL。
  - Agent realpath 拿不到结果时不再退回未解析的输入（原先会让所有检查形同虚设）。同时接受 Windows 盘符结果，以免引入兼容回退；存储节点本来就不对 Windows 使用 Agent。
  - LOCAL 的 `resolveStoragePathWithinBase` 采用同一“不跳转”规则。只是以两个点开头的名字（`..cache`）按路径段判断，仍然合法。
- **界限（TOCTOU）**：检查与操作是两次独立的 SFTP 请求。拥有该远端账号 shell 权限的人可以在两次之间把目录换成链接；SFTP 没有 openat/O_NOFOLLOW 链，无法彻底排除。存储用户无法通过平台创建链接（解压会拒绝含链接的归档），所以剩余窗口需要已经控制远端账号的人并发修改。
- **证据**：`remote-containment.process.test.ts`。进程内 SSH 服务器以真实文件系统提供 SFTP，并限制在测试沙箱内；Agent 执行器在本机运行真实 python。两种方式下覆盖：
  - 经出根链接的读、写、stat、改名、删除全部拒绝，根外文件一次都没被打开或创建；
  - 跨授权的兄弟链接拒绝；
  - 链接作为节点根、新的多级路径、`..cache` 都可以正常使用；
  - LOCAL 用例。

  修复前 10 例中 7 例失败（返回根外字节）；`..cache` 用例在过渡版本的检查下失败。

## 3. 关于 F-01～F-47 矩阵

矩阵用于理解产品目标，本次没有把其中的设计建议扩展为新功能。涉及的、仍待产品决策的方向见第 6 节，例如有效权限模拟器、全站维护模式、精确恢复模式、步骤幂等声明、统一 correlationId 时间线。

## 4. Schema 迁移与兼容性

| 迁移 | 内容 | 兼容性 |
| --- | --- | --- |
| `20261012120000_scheduled_task_claimed_occurrence` | `scheduled_tasks."claimedOccurrenceAt" TIMESTAMP(3)` 可空 | 只增不改。旧代码忽略该列；无需回填。回滚旧代码后，残留的认领值只会在新代码再次部署时被使用或清除。 |
| `20261012130000_alert_incident_delivery_retry` | `alert_incidents` 增加 `pendingNotifyChannels TEXT[] DEFAULT '{}'`、`notifyAttempts INT NOT NULL DEFAULT 0`、`nextNotifyAt`、`lastNotifyError` | 只增不改、带默认值。旧代码忽略；已有事件视为无待补投。 |
| `20261013090000_command_target_outcome_unknown` | `command_targets."outcomeUnknown" BOOLEAN NOT NULL DEFAULT false`（S05） | 只增不改、带默认值。旧代码忽略；已有目标视为结果已知。 |

`prisma migrate deploy` 已在一次性数据库上从空库应用全部迁移，`prisma migrate diff`（迁移后数据库对 schema.prisma）为空，`prisma format --check` 通过。

**行为变化（发布说明需要提及）**：
- 单向/镜像同步的源目录不存在时，作业失败而不再自动创建。
- **应用内不再执行恢复**：备份页“恢复”只校验备份并给出离线步骤；`POST /api/backups/:id/restore` 返回 `{ offlineRestore }`；旧版本排入的恢复任务以错误结束。恢复脚本在服务未确认停止或仍有数据库连接时拒绝执行；非 systemd 部署需设置 `VCONTROLHUB_SERVICE_UNITS=none`。
- 快捷应用安装、更新约多 10 秒验收。
- `GET /api/share-links`、`GET /api/media` 响应新增 `total/page/pageSize` 字段（原字段不变）。
- CI 新增 RBAC 漂移门禁。
- Agent 任务超时后若 Agent 已领取，不再回退 SSH；无法确认停止时报错并标记结果未知，Playbook 不会重试该步骤。
- 下载取消在远端无法确认停止时返回 502，任务保持运行中。
- WebDAV MOVE/COPY 到仍有回收站内容的路径返回 409。
- 配额改为按覆盖增量计费；版本恢复受单文件上限与配额约束。
- **存储节点（SFTP 与 LOCAL）根目录以下的符号链接不再可经平台访问**：经过链接的读、写、改名、删除、列表、下载、分享都会被拒绝（错误提示路径经过符号链接）。节点根本身是链接仍可用。若有部署依赖根内链接，应改为把目标目录单独配置为节点，或为其设置相应授权的独立节点。
- Playbook 命令步骤在命令是否停止无法确认时（包括数据库读写暂时失败）不再重试，该步骤失败并保留原命令关联。

## 5. 验证环境与结果

- **依赖**：在工作区执行 `npm ci`，生成独立的 `node_modules` 与 Prisma 客户端。没有使用生产的 node_modules/.next/dist，也没有复制 `.env` 或密钥。
- **测试数据库**：用系统自带的 PostgreSQL 16 二进制，以 `postgres` 用户在 `/tmp/claude-audit-pg-20261012` 新建独立集群（端口 55439，数据库 `vcontrolhub_audit_test`）。与生产实例（5432）完全分离；集成测试自建自删数据。
- **原报告实验**：`proofs.py` 复制到 `/tmp/claude-audit-work/` 并把 REPO 改为本工作区后执行，修复前在本工作区复现了全部 4 个现象。修复后再次执行：
  - tar 源端失败现在返回 1，目标未收到部分数据；k6 入口拿到存在的脚本。
  - restore-files 覆盖合并为既定语义，结果不变。
  - 第 1 例仍显示目标被清空，这是预期结果：该脚本自行 `mkdir` 源目录、直接调用 tar 命令构造器，模拟的正是修复前运行时的行为。新的防护位于运行时探测（不创建源、拒绝空源镜像），由 `mirror-source-guard.test.ts` 端到端验证。

**最终验证**：在最终代码 `eef6fa9d` 上统一运行，所有退出码均为实测值；本报告提交只改动文档。

| 检查 | 结果 |
| --- | --- |
| `npm run typecheck` | exit 0 |
| `npm run lint`（max-warnings=0） | exit 0 |
| 全量 Vitest（`RUN_DATABASE_INTEGRATION_TESTS=1`，一次性库，`FILE_VERSION_DIR` 指向临时目录） | exit 0：815 个测试文件；6517 passed，3 skipped，0 failed；耗时 636 秒 |
| `npm run route:verify` | exit 0：56 pages、189 API routes、52 permissions |
| `npm run docs:check` | exit 0 |
| `npm run i18n:key-check` | exit 0：缺失 0，中英不一致 0 |
| `npm run api-copy:audit` | exit 0：0 项 |
| `npm run rbac:audit -- --no-write` | exit 0：634 处调用、0 漂移 |
| `prisma migrate deploy` / `prisma migrate diff --from-config-datasource --to-schema` / `prisma format --check` | exit 0 / “No difference detected” / exit 0 |
| `npm run build`（Next 生产构建，在本工作区低优先级运行） | exit 0 |
| `npm run build:runtime` | exit 0 |
| `e2e/ssh-terminal-layout.spec.ts`（S01，真实浏览器实验环境） | exit 0：chromium、firefox、webkit 均通过。运行于 `c0d4a97c`；之后没有任何终端、代理、组件或 e2e 文件改动（`git diff` 为空），实验环境随后已停止 |

第三轮中途的全量运行（`cb3d26de`）没有通过：2 个文件 9 项失败。一个是 S10 后存储 action 测试的 SSH mock 缺少 realpath 桩，定向测试没有覆盖到；另一个是两个测试文件混用了制表符与空格。这些都是测试问题，已在 `9163c97c` 修正。随后因 R08 补充修复中止了一次重跑，上表是此后在最终代码上的完整运行。每次全量运行前后都对 `/var/lib/vcontrolhub` 的完整清单（路径与修改时间）做了比对，均无差异。

各项“修复前失败、修复后通过”的记录保存在 `/tmp/claude-audit-work/*-before.log`。

**S01 实验环境**：工作区内的自定义服务器（`next dev`）与 ssh-ws-proxy 运行在 127.0.0.1:3461/3462，连接一次性库 `vch_sshlab` 和进程内假 SSH 服务器，使用一次性密钥。验证完成后已停止，生产服务（含 3001 端口的生产代理）未受影响。

**第一轮全量测试**：第一次全量运行出现 5 项失败。其中 4 项是运行期间源文件被修改造成的不一致；另 1 项是真实的测试 mock 缺漏（`bc0771b5`）。之后的全量运行都在没有任何改动的情况下完成。

**测试数据目录事件（已处理）**：`FILE_VERSION_DIR` 默认是本机数据根 `/var/lib/vcontrolhub/file-versions`。S08 集成测试在开发时运行了 4 次，在该目录写入了 4 个仅含测试内容的版本文件（各 14 字节，位于以测试前缀命名的 `webdav-<uuid>/` 目录）。核对名称、时间、大小和内容确认它们只来自本次测试后，删除了这 4 个目录；其他文件均早于本次会话，没有改动。`2dab5fe4` 让测试默认使用每进程临时目录，最终全量运行前后对 `/var/lib/vcontrolhub` 的完整清单（路径与修改时间）逐项比对，没有差异。此前其他人留下的同类旧目录（10 月 1 日的 `webdav-locks-*`/`webdav-move-*`）没有触碰。

**未运行**：
- `npm run audit:high`：需联网查询 npm 漏洞库。
- 完整 E2E 套件（只运行了 S01 布局 spec）。
- 真实 VPS/Docker/SMTP/Webhook/ITSM。
- 真实数据库恢复演练（恢复脚本由一次性库和伪 systemctl 验证）。
- k6 容量测试。

**main 集成**：见第 8 节。

## 6. 剩余事项（未标为已修复）

1. **R04**：恢复的前提（所有实例保持停止）由运维保证，脚本只做时间点检查，不能防止检查后启动的实例。没有全站维护模式、影子库切换、恢复后自动业务探针和“精确还原”文件模式；恢复与 `deploy.sh` 之间的互斥已在后续提交中补上（deploy.sh 遇到活跃的 `.restore.lock` 拒绝启动；restore.mjs 遇到 deploy.sh 持有的部署锁拒绝执行）；其后又改为两边都先取得自己的锁再检查对方，二者同时启动时不会都通过检查，deploy.sh 因恢复拒绝启动时也会清空部署锁里的 PID。
2. **R01**：没有源挂载身份标记和删除比例阈值。
3. **R05**：没有步骤级幂等声明或人工确认，取消确认后的非幂等重试仍按配置进行。
4. **R07**：没有应用层就绪探针、镜像 digest 和数据卷恢复点。
5. **R08**：没有逐收件人投递追踪；补投为至少一次，可能重复发送。升级通知失败的渠道已在后续提交中纳入同一补投机制（升级时与认领一起持久化投递意图，未送达渠道按退避重发升级文案）。
6. **R13**：全文/向量检索、中文分词、召回评测集。
7. **R14**：缺样原因（采样器/主机/应用）区分需在采样与 rollup 中新增字段。后续（公开状态展示页提交）：每个指标样本记录采样间隔与控制端 TCP 探测结果（成功/失败/未测），每台服务器另有最新判定的离线原因（不可达/采集失败）；每日可用率改为按真实样本时间计覆盖分钟，采样器停止的时段计为未知，不再按“当前间隔”折算。逐日 rollup 仍未单独记录“采样器故障”。
8. **R15**：容量基线需要在隔离环境用真实负载测量。
9. **S02**：压缩、SFTP 同步、远端下载、跨授权移动等事先不知道大小的写入没有按字节准入。`.gz` 解压已在后续提交中按 gzip 尾部记录的解压大小做准入（单文件上限与配额），实际输出以已准入的大小为上限（多成员 gzip 的尾部只描述最后一个成员，超出即中止并删除半成品）。
10. **S10**：远端包含检查与实际操作之间存在 TOCTOU 窗口，只有已控制远端账号的人并发换链才能利用，SFTP 协议无法彻底排除。
11. **CI 外部条件**：main 的分支保护已由仓库管理员开启（4 项必需检查，见 `docs/ci-gates.md`；2026-10-13 核对 strict 关闭、enforce_admins 开启），本报告无法在代码中验证该设置。

## 7. 提交对应关系

| 提交 | 内容 |
| --- | --- |
| `80d06d05` | R02 tar 暂存接收与全阶段状态检查 |
| `9f68e319` | R01 不自动创建源、拒绝空源镜像覆盖 |
| `1c35d1d5` | R03 平台级恢复锁 + 主机级 CLI 锁 |
| `b0de217e` | R04 单事务恢复、DB 先于文件、后台停写排空、失败标注与历史（在线停写与应用内恢复已由 `4b5f1b78` 移除） |
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
| `bc0771b5` | R04 后续：恢复互斥集成测试补充排空查询的 mock（该测试随在线恢复一起移除） |
| `7bc5fa83` | 第一版核验报告 |
| `4b5f1b78` | R04 恢复改为仅离线执行，由恢复脚本检查前提 |
| `f0779e41` | R11 详情页上一项/下一项按列表顺序 |
| `4b1b580f` | S01 终端网格贴合可见区域、PTY 以该尺寸打开 |
| `a040b676` | S05 Agent 领取后不伪造完成（迁移） |
| `a5bec026` | S06 备份计划同事务认领与派发 |
| `1b567234` | S08 WebDAV MOVE/COPY/PUT 与回收站 |
| `91696492` | S03 ITSM 入站失败可重试 |
| `da68b3d9` | S04 下载取消确认整个远端进程树停止 |
| `2dab5fe4` | 测试默认使用临时文件版本目录 |
| `6a36c32c` | S02 版本恢复受限额约束、覆盖按增量计费 |
| `83d858ac` | S07 回滚以稳定键关联命令并恢复中断 |
| `eb50150e` | S09 内容搜索根目录与 SFTP 链接边界 |
| `9360a015` | S01 sm～lg 宽度不再强制最小高度 |
| `c0d4a97c` | R04 服务状态检查失败即拒绝；离线边界表述更正 |
| `76e4747d` | 第二版核验报告 |
| `1362653f` | S10 SFTP 存储物理路径包含；根以下不跟随链接（含 LOCAL） |
| `a35e1908` | R05/S05 取消等待与回收路径的结果未知检查 |
| `e3238528` | S03 入站业务写入与 applied 标记同事务 |
| `de1a6caf` | R05/S05 重试前统一失败关闭闸门（含数据库异常路径） |
| `cb3d26de` | S04 取消墓碑，防止落地较晚的启动超越已确认的取消 |
| `9163c97c` | S10 测试补充：存储 action 测试的 realpath 桩、缩进一致 |
| `eef6fa9d` | R08 投递意图随事件创建/重开一起持久化（至少一次） |

## 8. main 集成

审核分支 `fix/verified-audit-20261012` 连同全部本地提交（第 7 节的提交号即远端提交号）由用户授权的另一会话推送到远端，以 PR 合入 `main`，经过 4 项必需 CI 检查后合并，并通过 `deploy.sh` 部署到本机（迁移由 `prisma migrate deploy` 应用）。合并提交与部署时间见 `git log` 与 `CHANGELOG.md`。
