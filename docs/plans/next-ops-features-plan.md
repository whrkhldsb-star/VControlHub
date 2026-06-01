# 下一阶段运维功能批量实现计划

## 目标
把当前 VPS 统一管理 + 分布式云盘系统继续推进成可交付、可迁移、可长期运维的平台。第一批实现以“基础后端能力 + 页面入口 + 可测试服务层”为主，避免重复造轮子，优先复用现有 `CommandRequest`、`ScheduledTask`、`DownloadTask`、`SyncJob`、`Notification`、`CommandTemplate`、`FileEntry`、`StorageNode`、`Server`。

## 审计结论
- 现有 RBAC 只有 `audit/command/role/server/storage/user` 权限，需要新增 `health:*`、`task:*`、`backup:*`、`share:*`、`deploy:*`、`notification:*`。
- `/api/commands` 缺失，但前端 `templates` 与 `servers` 已经请求该接口，应优先补齐。
- 健康中心已有 `src/lib/health/service.ts` 与 `/health` 页面，可新增平台自检服务/API 并接入页面。
- 统一任务中心无需第一批新增统一任务表，可聚合命令、定时、下载、同步、备份、部署记录。
- 文件索引已有 `FileEntry`，分享链接需要新增独立模型并严格遵守 ACL。
- 通知已有站内信，通知渠道可以先通过 `Setting` 管理，后续再抽象独立渠道表。
- 应用部署模板可先复用/扩展 `CommandTemplate`，新增部署运行记录，模板执行仍走命令审批/执行链路。
- 备份恢复迁移应先做 Web 可见的备份记录与脚本触发封装，恢复动作需要明确高风险确认。

## 第一批数据模型
新增模型建议：
- `ShareLink`：文件/目录分享链接，包含 token hash、存储节点、路径、权限、过期时间、访问次数、创建人。
- `BackupRecord`：备份任务记录，包含类型、状态、文件路径、大小、checksum、错误信息、创建人。
- `DeploymentRun`：模板部署运行记录，关联 `CommandTemplate` 与可选 `CommandRequest`，记录目标节点、变量、状态。

暂不新增：
- `OperationTask` 统一表：第一批用聚合服务减少迁移风险。
- `NotificationChannel` 表：第一批复用 `Setting`，后续需要多渠道、多接收人时再拆表。

## 第一批服务/API/UI
1. 权限与 seed
   - 扩展 `src/lib/auth/rbac.ts` 与 `prisma/seed.ts` 权限标签。
   - 管理员获得全部权限；operator 获得 health/task/deploy 基础权限；viewer 可读 health/task/share；storage_manager 获得 share/storage 相关权限。

2. 系统健康中心 / 一键体检
   - 新增 `src/lib/system-health/service.ts`。
   - 新增 `src/app/api/system-health/route.ts`。
   - 接入 `/health` 页面展示数据库、迁移、运行目录、部署脚本、环境占位符、存储节点、VPS 节点基础状态。

3. 统一任务中心
   - 新增 `src/lib/operation-task/service.ts` 聚合命令、定时任务、下载、同步、备份、部署。
   - 新增 `/api/operation-tasks` 与 `/operation-tasks` 页面。
   - 只做查看、过滤、跳转来源详情；后续再做取消/重试。

4. 命令 API 缺口与部署模板
   - 新增 `/api/commands`，兼容前端已有 `targetServerIds` 字段，内部映射到 `createCommandRequest(serverIds)`。
   - 新增部署运行服务/API，模板下发时记录 `DeploymentRun` 并关联命令请求。
   - 后续可加入应用市场分类、变量校验、部署前检查。

5. 分享链接
   - 新增 `src/lib/share-link/service.ts` 与 `/api/share-links`。
   - Token 只保存 hash；创建分享前校验 `storage:read` 与路径 ACL。
   - 公共访问端第一批只暴露元数据与受控下载入口，不绕开已有 SFTP/download 安全边界。

6. 备份恢复迁移
   - 新增 `src/lib/backup/service.ts` 与 `/api/backups`。
   - 第一批实现记录、计划命令生成、脚本存在性检查、可触发备份；恢复动作仅提供受控接口骨架和高风险校验。
   - 继续复用 `deploy/backup.sh` 与 `scripts/restore-db.sh`。

7. 通知渠道
   - 在设置页补充 webhook/Telegram/email 基础开关占位与 API 验证。
   - 第一批确保告警/备份/部署可以写站内通知；外部渠道发送可作为第二批。

8. 云盘扫描索引
   - 第一批补充存储索引扫描服务/API，可对本地节点扫描写入/更新 `FileEntry`。
   - SFTP 深度扫描放第二批，避免长任务阻塞请求。

## 当前未来目标更新（2026-06-01）

根据自动维护复盘与用户反馈，后续 GitHub 上可见的未来目标需要随每个“大轮”完成而同步更新，避免仓库路线图落后于实际产品方向。当前优先级调整如下：

1. **减少零碎提交**：自动清单修复不再以每个小修小补为一个 GitHub commit 的默认节奏；应把同一功能域的一组修复、测试、部署验证、backlog/state 更新和本路线图更新合并到一次“大轮完成”提交。生产紧急修复、上一轮 dirty closeout 或 blocker 保全除外。
2. **大轮完成后全面检查**：每个大轮 closeout 必须重新检查生产健康、关键用户路径、相关测试、日志、git/origin 同步，并把新发现或优先级变化写回 `.hermes/remediation-backlog.md`、`.hermes/remediation-state.json` 和本 `docs/plans/*` 路线图。
3. **Settings 页面丰富化**：Settings 应升级为中心化自定义/控制台，而不仅是少量管理字段。优先补齐：运行时稳定性参数、列表/轮询限制、SSH/SFTP/命令执行参数、通知渠道、SMTP/AI/image bed/API token 等集成选项、UI/主题/语言/默认页偏好、功能开关和其他安全的非敏感设置。所有设置都必须真的影响运行时行为，有校验边界、即时/需重启说明、测试和生产路径验证。
4. **仍以真实可用为核心**：Settings 丰富化不能变成“保存但无副作用”的假功能；也不能长期挤占 VPS、Files、Downloads、Quick Services、Commands、Backups、Health 等真实功能 QA。
5. **VPS/SSH 可用性 QA 方向**：完成 SSH 终端基础可访问性/light-theme 修复后，下一步继续用生产浏览器验证 VPS 管理的真实用户路径：编辑/删除的安全边界、Direct Gateway 资格/失败恢复提示、服务健康 badge、终端空闲稳定性和复制/重试/恢复指导，确保“按钮可点”对应真实连接、配置或清晰失败状态。

## 验证
- 先写 Vitest：system-health、operation-task、share-link、backup、commands API/service。
- 运行：`npm run prisma:generate`、`npm run typecheck`、`npm run lint`、`npm test`、`npm run build`。
- 安全扫描：不得出现 PEM 私钥块、带密码数据库连接串、真实 token/password。
- 精确 `git add -- ...`，不得 `git add .`。
- 部署后重启 `whrkhldsb-next.service` 与 `whrkhldsb-ssh-ws.service`，smoke check `/login`、`/files`、`/api/health`、新增页面、files-proxy、emby-web。
