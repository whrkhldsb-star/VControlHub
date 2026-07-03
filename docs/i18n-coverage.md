# VControlHub i18n Coverage Report

> Generated: 2026-07-02T06:22:30.359Z | Files: 306 | Strings: 203 | Coverage: **46.8%** (95/203)

This report cross-references hardcoded Chinese strings in `src/app/**/*.tsx` and `src/components/**/*.tsx` against the values in `src/lib/i18n/translations.ts`. A string is **covered** when its exact value already exists in the `zh` translation map; **missing** strings are candidates for new translation keys (or for relocation to the `dom-bridge` runtime substitution system).

Strings inside `data-i18n-skip` regions, in `<script>` tags, or in JSX expressions (`{...}`) are not audited.

## Module coverage (lowest first)

| Module | Strings | Covered | Missing | Coverage |
|---|---|---|---|---|
| `src/app/deployments` | 3 | 0 | 3 | 0% |
| `src/app/health` | 2 | 0 | 2 | 0% |
| `src/app/operation-tasks` | 1 | 0 | 1 | 0% |
| `src/app/status` | 2 | 0 | 2 | 0% |
| `src/app/traffic` | 1 | 0 | 1 | 0% |
| `src/components/ui-primitives.tsx` | 2 | 0 | 2 | 0% |
| `src/app/requests` | 7 | 1 | 6 | 14.3% |
| `src/app/audit` | 8 | 2 | 6 | 25% |
| `src/app/settings` | 18 | 6 | 12 | 33.3% |
| `src/app/servers` | 53 | 21 | 32 | 39.6% |
| `src/app/global-error.tsx` | 4 | 2 | 2 | 50% |
| `src/app/shares` | 6 | 3 | 3 | 50% |
| `src/app/files` | 55 | 29 | 26 | 52.7% |
| `src/app/backups` | 7 | 4 | 3 | 57.1% |
| `src/app/image-bed` | 5 | 3 | 2 | 60% |
| `src/app/quick-services` | 4 | 3 | 1 | 75% |
| `src/app/storage` | 4 | 3 | 1 | 75% |
| `src/app/docker` | 6 | 5 | 1 | 83.3% |
| `src/app/scheduled-tasks` | 13 | 11 | 2 | 84.6% |
| `src/app/announcements` | 1 | 1 | 0 | 100% |
| `src/components/page-shell.tsx` | 1 | 1 | 0 | 100% |

## Top missing strings (frequency-sorted)

Each row is a Chinese string that appears in source but has no matching key in `translations.ts`. Add the string as a `zh` value, then optionally provide an `en` value, then reference via `t("<key>")` or the `dom-bridge` data-i18n system.

| String | Count | First 3 occurrences |
|---|---|---|
| 移动 | 2 | `src/app/files/move-inline-form.tsx:66` (title), `src/app/files/move-inline-form.tsx:90` (text) |
| 去系统自检 | 1 | `src/app/audit/page.tsx:43` (text) |
| 高风险动作监控 | 1 | `src/app/audit/page.tsx:62` (text) |
| 已重点跟踪命令执行、文件删除、服务器删除、权限变更、容器重启和令牌创建。当前 WARNING 占比  % ，CRITICAL 占比  % ，异常增多时优先从下方日志按动作筛选复核。 | 1 | `src/app/audit/page.tsx:63` (text) |
| 按动作筛查： | 1 | `src/app/audit/page.tsx:70` (text) |
| 最常见动作 | 1 | `src/app/audit/page.tsx:77` (text) |
| 暂无动作统计。 | 1 | `src/app/audit/page.tsx:80` (text) |
| 输入 RESTORE 确认恢复 | 1 | `src/app/backups/restore-backup-button.tsx:88` (text) |
| 已加入清理队列，详情可在 | 1 | `src/app/backups/retention-button.tsx:97` (text) |
| 已重新排队，可在 | 1 | `src/app/backups/retry-backup-record-button.tsx:48` (text) |
| 部署模板 | 1 | `src/app/deployments/deployment-launch-form.tsx:102` (text) |
| 部署原因 | 1 | `src/app/deployments/deployment-launch-form.tsx:113` (text) |
| | null}
										serverIds= 
										reason= `}
										label="按此记录重发"
									/> | 1 | `src/app/deployments/page.tsx:137` (text) |
| 管理本机 Docker socket 上的网络与数据卷。 | 1 | `src/app/docker/docker-resources-panel.tsx:145` (text) |
| 确认删除  
         ？ | 1 | `src/app/files/delete-confirm-button.tsx:91` (text) |
| 批量操作完成，  
            个失败 | 1 | `src/app/files/file-batch-toolbar.tsx:73` (text) |
| 文件批量操作 | 1 | `src/app/files/file-batch-toolbar.tsx:92` (text) |
| 已选择   
            个文件，可取消选择或执行当前权限允许的批量操作。 | 1 | `src/app/files/file-batch-toolbar.tsx:95` (text) |
| 确认删除   个文件？ | 1 | `src/app/files/file-batch-toolbar.tsx:101` (text) |
| 已删除  /  个 | 1 | `src/app/files/file-batch-toolbar.tsx:123` (text) |
| 个失败 | 1 | `src/app/files/file-batch-toolbar.tsx:137` (text) |
| 正在创建压缩包... | 1 | `src/app/files/file-batch-toolbar.tsx:144` (text) |
| / 
                    个失败）`
                    : ""} | 1 | `src/app/files/file-batch-toolbar.tsx:148` (text) |
| 目标路径： | 1 | `src/app/files/file-batch-toolbar.tsx:158` (text) |
| 批量移动目标路径 | 1 | `src/app/files/file-batch-toolbar.tsx:161` (aria-label) |

## Files with missing translations (most gaps first)

### `src/app/files/file-batch-toolbar.tsx` — 17/20 missing (15%)

- L73 text "批量操作完成，  
            个失败"
- L92 text "文件批量操作"
- L95 text "已选择   
            个文件，可取消选择或执行当前权限允许的批量操作。"
- L101 text "确认删除   个文件？"
- L123 text "已删除  /  个"
- L137 text "个失败"
- L144 text "正在创建压缩包..."
- L148 text "/ 
                    个失败）`
                    : ""}"
- _…and 9 more_

### `src/app/servers/ssh-key-create-form.tsx` — 15/18 missing (16.7%)

- L18 text "添加 SSH 密钥"
- L19 text "用于节点纳管的 SSH 密钥对"
- L27 placeholder placeholder= "例如 prod-key"
- L35 text "支持 PuTTY .ppk、OpenSSH、PEM (PKCS#1/PKCS#8/SEC1) 格式。上传文件时后端自动识别格式并转换；也可直接粘贴私钥内容。"
- L40 text "私钥"
- L41 placeholder placeholder= "粘贴 SSH 私钥内容；如果上传 .ppk 可留空"
- L45 text "公钥"
- L50 text "私钥口令（可选）"
- _…and 7 more_

### `src/app/settings/team-workspace-section.tsx` — 12/17 missing (29.4%)

- L182 text "团队空间"
- L183 text "多租户资源隔离：创建团队、切换当前团队，维护成员并管理服务器归属。切换团队后服务器列表按团队过滤。"
- L190 text "加载团队空间中…"
- L192 text "暂无团队空间。"
- L207 text "/  ·   成员"
- L248 text "…还有   名成员"
- L259 text "创建团队空间"
- L260 placeholder placeholder= "团队名称"
- _…and 4 more_

### `src/app/servers/batch-server-action-panel.tsx` — 9/10 missing (10%)

- L45 text "批量节点操作"
- L46 text "先勾选节点，再统一启用或停用。适合维护窗口和巡检后的回收操作。"
- L48 text "当前共有   台启用节点，已选中   台"
- L58 text "已选中：  台"
- L60 text "其中启用   台，停用   台"
- L61 text "当前为部分选择"
- L88 text "确认停用   台节点"
- L97 text "批量停用所选节点"
- _…and 1 more_

### `src/app/audit/page.tsx` — 6/8 missing (25%)

- L43 text "去系统自检"
- L62 text "高风险动作监控"
- L63 text "已重点跟踪命令执行、文件删除、服务器删除、权限变更、容器重启和令牌创建。当前 WARNING 占比  % ，CRITICAL 占比  % ，异常增多时优先从下方日志按动作筛选复核。"
- L70 text "按动作筛查："
- L77 text "最常见动作"
- L80 text "暂无动作统计。"

### `src/app/requests/batch-review-toolbar.tsx` — 6/6 missing (0%)

- L121 aria-label aria-label= "全选待审批"
- L128 text "全选（ ）"
- L133 text "已选   条"
- L150 aria-label aria-label= "批量审批操作栏"
- L158 text "批量审批备注"
- L161 placeholder placeholder= "批量审批备注（选填，将应用到全部 N 条）"

### `src/app/servers/server-monitor-card.tsx` — 5/8 missing (37.5%)

- L128 text "监控连接失败："
- L148 text "实时监控"
- L167 text "负载   /   /"
- L203 text "网络流量"
- L217 text "运行"

### `src/app/deployments/deployment-launch-form.tsx` — 2/2 missing (0%)

- L102 text "部署模板"
- L113 text "部署原因"

### `src/app/files/move-inline-form.tsx` — 2/5 missing (60%)

- L66 title title= "移动"
- L90 text "移动"

### `src/app/files/permanent-delete-button.tsx` — 2/4 missing (50%)

- L38 text "永久删除"
- L47 text "⚠️ 永久删除  ？此操作不可恢复！"

### `src/app/global-error.tsx` — 2/4 missing (50%)

- L25 text "出错了"
- L26 text "页面遇到了意外错误，请尝试刷新。如果问题持续出现，请联系管理员。"

### `src/app/health/active-incidents-banner.tsx` — 2/2 missing (0%)

- L59 aria-label aria-label= "活跃事件公告"
- L69 text "开始:  
                 ` : ""}"

### `src/app/scheduled-tasks/scheduled-task-list-client.tsx` — 2/12 missing (83.3%)

- L300 text "创建定时任务"
- L333 text "原因 / 备注"

### `src/app/shares/share-row-actions.tsx` — 2/4 missing (50%)

- L48 text "撤销后该分享链接将立即失效且无法恢复。"
- L72 text "确认撤销分享链接"

### `src/app/status/page.tsx` — 2/2 missing (0%)

- L109 text "历史可用率（90 天）"
- L110 text "显示过去 90 天的服务器 uptime 情况"

### `src/components/ui-primitives.tsx` — 2/2 missing (0%)

- L151 text ");
}

/* ════════════════════════════════════════════════════════════════
 * ProgressBar — 进度条
 * 使用 var(--accent) 填充色，支持语义色调
 * ════════════════════════════════════════════════════════════════ */

export function ProgressBar( :  )  [tone];

	return ("
- L332 text ";
}

/* ════════════════════════════════════════════════════════════════
 * IconButton — 图标按钮
 * 统一 sidebar/toolbar 中反复出现的 icon-only button 模式
 * ════════════════════════════════════════════════════════════════ */

export function IconButton( :   & ButtonHTMLAttributes"

### `src/app/backups/restore-backup-button.tsx` — 1/3 missing (66.7%)

- L88 text "输入 RESTORE 确认恢复"

### `src/app/backups/retention-button.tsx` — 1/2 missing (50%)

- L97 text "已加入清理队列，详情可在"

### `src/app/backups/retry-backup-record-button.tsx` — 1/2 missing (50%)

- L48 text "已重新排队，可在"

### `src/app/deployments/page.tsx` — 1/1 missing (0%)

- L137 text "| null}
										serverIds= 
										reason= `}
										label="按此记录重发"
									/>"
