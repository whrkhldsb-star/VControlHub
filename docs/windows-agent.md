# Windows 节点 Agent 接入设计

本文描述 Windows 节点如何通过 Agent 通道获得监控与命令执行能力。Linux 节点的 Agent（Python + systemd，经 SSH 推送安装）见 `src/lib/server/agent-service.ts` 中的 `buildAgentPython` / `installServerAgent`。

## 背景

Windows 节点此前只有浏览器 RDP 通路（见 `docs/windows-remote-desktop.md`），没有监控指标、命令执行与文件能力。Windows 节点不保存 SSH 凭据，因此无法像 Linux 那样由平台通过 SSH 推送安装 Agent —— Windows Agent 采用**操作员手动执行一条 PowerShell 命令**的引导方式。

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
- `APP_BASE_URL` 必须为 HTTPS（localhost 除外）；嵌入 Agent 的 poll 地址取自 `APP_BASE_URL` 而非请求 Host 头，反代无法降级

## 卸载

`uninstallServerAgent` 对 Windows 节点：通过 Agent 派发自删除命令（`AGENT_WINDOWS_CLEANUP_COMMAND`，分离的隐藏 cmd 延迟 3s 后 `schtasks /end` + `schtasks /delete` + 删除目录，对应 Linux 的 nohup 自删除模式），随后**总是**吊销令牌。Agent 离线时仅吊销令牌并提示手动清理。

## 仍然 Linux-only 的能力

SSH 终端、SFTP 文件管理、Docker/Compose、快速服务、VPS 备份对 Windows 目标保持拒绝（见 `src/__tests__/windows-linux-operation-guards.test.ts`）；批量命令执行在 Windows 节点上走 Agent 通道。RDP 独立于 Agent 继续可用。
