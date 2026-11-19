# Windows 节点 Agent 接入设计

本文描述 Windows 节点如何通过 Agent 通道获得监控与命令执行能力。Linux 节点的 Agent（Python + systemd，经 SSH 推送安装）见 `src/lib/server/agent-service.ts` 中的 `buildAgentPython` / `installServerAgent`。

## 背景

Windows 节点最初只有浏览器 RDP 通路（见 `docs/windows-remote-desktop.md`），没有监控指标或命令执行能力。Agent 仍采用**操作员手动执行一条 PowerShell 命令**的引导方式。可选的 OpenSSH/SFTP 云盘凭据与 Agent 和 RDP 凭据独立；它用于文件浏览、传输和直连网关，不用于自动安装 Agent。

## 架构

```
Windows 机器                          Hub (VControlHub)
┌──────────────────────────┐          ┌────────────────────────────────┐
│ 计划任务 VControlHubAgent │  HTTPS   │ /api/agent/v1/poll            │
│  └─ powershell agent.ps1 │ ───────▶ │  (Bearer vca_<id>_<secret>)   │
│     轮询 + 执行 + 指标    │ ◀─────── │  下发 job / pollAfterMs       │
└──────────────────────────┘          │ /api/agent/v1/bootstrap       │
     ▲ 安装：irm + iex 一条命令        │  (Bearer 同一令牌, 安装器脚本) │
     └── 由操作员在管理员 PowerShell 执行└────────────────────────────────┘
```

两个平台的 Agent 说**同一个轮询协议**（`POST /api/agent/v1/poll`）：

- 请求体：`{ version, capabilities: ["metrics","command"], result?, metricsRaw?, heartbeatJobId? }`
- 响应体：`{ job: { id, command, timeoutMs } | null, pollAfterMs, cancelled? }`
- 认证：`Authorization: Bearer vca_<serverId>_<secret>`，hub 仅存 SHA-256 摘要（`timingSafeEqual` 比较）
- 心跳/租约：长任务每 ~20s 心跳一次；hub 侧租约 30s（`AGENT_JOB_HEARTBEAT_MS`），过期任务标记 CANCELLED（exitCode 124）；agent 最后一次心跳超过 90s（`AGENT_FRESH_MS`）视为不新鲜，命令执行回退（Linux 回退 SSH；Windows 无回退，直接报错）
- 输出上限：stdout 8MB / stderr 1MB；退出码收窄到 0–255（Windows 原生 32 位退出码在 Agent 侧截断）

## Windows Agent 实现（PowerShell 5.1）

`buildAgentPowerShell(hubUrl, token)` 生成内嵌令牌的 PowerShell 脚本，要求 Windows 10 / Server 2016 及以上：

- **运行时**：`System.Net.Http.HttpClient`（35s 超时），外层 `while ($true)` + try/catch，异常退避 5s
- **命令执行**：`cmd.exe /c chcp 65001 >nul & <command>`，重定向 stdout/stderr 并按 UTF-8 解码；超时或取消时 `taskkill /PID <pid> /T /F` 连带子进程树终止
- **指标采集**：每 60s 一次，输出与 Linux `MONITOR_SCRIPT` 相同的 `===SECTION===` 格式（hub 侧 `parseMonitorScriptOutput` 零改动解析）：
  - CPU：`Win32_PerfFormattedData_PerfOS_Processor(_Total)` 的使用率编码为 `idle/total = (100-usage)/100`
  - 内存：`Win32_OperatingSystem`（TotalVisibleMemorySize / FreePhysicalMemory）
  - 磁盘：`Win32_LogicalDisk (DriveType=3)`，挂载点（盘符）为行尾字段，与 `df --output` 行形一致
  - 网络：`Get-NetAdapterStatistics`；负载均值无对应概念，上报 `0 0 0`
- **能力声明**：`["metrics","command"]`（与 Linux Agent 一致；协议中没有 "file" 能力）

## 安装流程

1. 用户将 Windows 节点的管理通道切换为「节点 Agent」（创建或编辑节点）
2. 节点卡片出现 Agent 面板，点击「获取 Agent 安装命令」→ `prepareWindowsAgentInstall` 签发新令牌（旧令牌即作废）并返回一条命令：
   ```powershell
   & ([scriptblock]::Create((Invoke-RestMethod -UseBasicParsing -Uri '<hub>/api/agent/v1/bootstrap' -Headers @{ Authorization = 'Bearer vca_...' })))
   ```
3. 操作员在 Windows 机器上以管理员身份打开 PowerShell 执行该命令：
   - `GET /api/agent/v1/bootstrap`（Bearer 认证、IP 限流与 poll 相同）返回安装器脚本（`buildWindowsAgentInstaller`）
   - 安装器将 Agent（base64 内嵌）写入 `%ProgramData%\VControlHub\agent.ps1`
   - 注册 SYSTEM 计划任务 `VControlHubAgent`：开机启动（`AtStartup`）、失败后 1 分钟重启（`RestartCount 999`）、无执行时限截断、`RunLevel Highest`
   - `Start-ScheduledTask` 立即启动，Agent 开始轮询
4. 节点卡片状态变为「Agent 在线」；监控页与实时探测（`/api/servers/monitor`）读取 Agent 上报的指标

### 安全属性

- 令牌只显示一次（获取新命令即轮换），hub 仅存哈希
- bootstrap 与 poll 同一 Bearer 凭据：持有令牌即已具备命令执行权，下载安装器不引入新权限
- 安装器强制管理员上下文；Agent 以 SYSTEM 运行（与 Linux systemd 部署等权）
- Hub 地址必须为 HTTPS（localhost 除外）：取 `NEXT_PUBLIC_APP_URL` / `APP_BASE_URL`，都未设置时用安装脚本记录的 `DOMAIN`（`https://DOMAIN`）；嵌入 Agent 的 poll 地址取自这里而非请求 Host 头，反代无法降级

## 卸载

Windows Agent 在线时会接收自卸载请求。延迟清理与新安装使用同一个主机锁。若等待期间已经重装，旧清理会跳过新身份对应的任务和文件。控制台在切换时吊销旧令牌。主机离线时，需在主机恢复后核对计划任务。

## 平台能力边界

Windows 的审批命令、Playbook 命令步骤和部署命令需要在线 Agent。运维目标选择与提交时会检查同一组条件。RDP 继续使用自己的账号与证书策略。Windows 的交互式 SSH 终端与云盘共用单独配置的 OpenSSH 连接。Docker/Compose、快速服务和 VPS 备份当前面向 Linux。[Windows 指南](windows-development.md)

### 切换管理方式

| 操作 | 保存时的处理 | 如何确认 |
| --- | --- | --- |
| Linux 直连 → Agent | 重新输入 SSH 密码或选择密钥，验证指纹和登录。已启用的远程节点用这次配置安装 Agent。 | 查看新心跳。保留 SSH 凭据可继续使用交互终端和原生 SFTP。 |
| Linux Agent → 直连 | 先验证目标 SSH 登录，尝试清理原主机上的服务，保存时撤销旧令牌并清空旧心跳。 | SSH 验证失败会保留原配置。界面提示清理失败时，需在原主机核对服务。 |
| Windows 直连 → Agent | 保存后，进入节点详情生成新的 PowerShell 安装命令。 | 新 Agent 首次上报后，节点可作为运维命令目标。 |
| Windows Agent → 直连 | 重新输入 RDP 密码。在线 Agent 会先接收自卸载请求。离线时也会撤销旧令牌。独立配置的 OpenSSH/SFTP 继续使用原设置。 | 打开 RDP 检查远程桌面。主机离线时，恢复后核对计划任务。 |

模式变更会取消旧队列中尚未领取的作业。已领取且未回报的作业保留“远端结果未知”语义，避免切换后重复执行。Linux 保留 SSH 凭据时，审批命令可在 Agent 尚未接单时回退到 SSH。绑定云盘优先使用已配置的原生 SFTP。仅使用 Agent 的 Linux 节点可处理同一主机与账号下受大小限制的文件操作。云盘的健康检查会显示本次使用的通道。


### 日常运维和文件传输

| 网站操作 | Linux 直连 | Linux Agent | Windows |
| --- | --- | --- | --- |
| 审批命令、Playbook 命令步骤、部署命令 | SSH | 优先使用在线 Agent。已配置并验证 SSH 时，只有确认 Agent 未领取任务才可回退。 | 需要在线 Agent。 |
| 容器管理、Compose、快速服务、网卡流量采样 | SSH | 优先使用 Agent。备用 SSH 使用已固定的主机指纹。 | 这些操作使用 Linux 上的工具。 |
| 交互式终端 | SSH | 使用保留的 SSH 登录。 | RDP 或单独配置的 OpenSSH。 |
| 绑定云盘的文件浏览、上传与下载 | SFTP | 有 SSH 凭据时使用 SFTP。仅有 Agent 时，通过当前节点处理小文件。 | 使用单独验证的 OpenSSH/SFTP。 |

AI 助手的只读运维查询会记录实际使用的通道。Linux 节点等待 Agent 后准备回退时，会重新检查节点是否启用、调用者连接权限、目标主机和登录凭据。Windows 节点无法用独立的 SFTP 凭据回退执行这些查询，查询模板也需适配目标操作系统。

更换 Agent 主机地址会撤销原主机的身份。Linux 修改 SSH 端口也会触发重新配置，以支持同一地址通过不同端口映射多台机器。云盘绑定到另一主机、端口或账号时需要可用的 SFTP 登录。Linux 纯 Agent 通道单文件读写上限均为 6,000,000 字节。需要传大文件时，可保留原生 SFTP，也可创建独立的出站 Agent 云盘。Linux 和 Windows 均可在节点本机授权共享目录，支持断点续传和 SHA-256 校验。[文件 Agent 配对步骤](../agent-files/README.md)
