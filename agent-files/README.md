# Agent 云盘

文件 Agent 通过出站 HTTPS 为一个云盘提供指定目录。Linux 和 Windows 使用同一文件协议。文件凭据绑定当前管理 Agent 的身份和团队。SSH、命令 Agent 和已有 SFTP 云盘继续使用各自的配置。

1. 在“文件 → 存储节点”中创建 Agent 云盘，选择已启用 Agent 管理的服务器。已有 SFTP 云盘的服务器也可选择。
2. 在新云盘卡片中选择“配对或更换文件 Agent”，生成配置。把 JSON 保存在节点上共享目录之外，仅允许运行文件 Agent 的账户读取。Linux 可使用权限 `0600`。Windows 可使用仅该账户和管理员可读的 NTFS ACL。
3. 将 `root` 填为本机已有目录的绝对路径。Linux 示例为 `/srv/backups`，Windows 的 JSON 路径示例为 `D:\\Backups`。已有文件会出现在云盘内。默认只读，若需接收上传，将 `writable` 设为 `true` 并赋予运行账户相应的目录权限。
4. 从包含本功能的 GitHub Release 选取匹配系统和 CPU 的 `vch-files-*`，按 `agent-files.sha256` 核对文件。运行时无需 Go。也可在此目录用 Go 1.25 或更高版本运行 `go build -trimpath -o vch-files .`，Windows 输出文件名用 `vch-files.exe`。
5. Linux 运行 `./vch-files -config /path/to/file-agent.json`，Windows 运行 `.\vch-files.exe -config C:\VControlHub\file-agent.json`。长期运行时可使用专用低权限账户和系统服务或计划任务。网站中的“立即检测”会探测共享目录。

站点的文件 ACL、回收站和上传配额仍适用。文件以 1 MiB 分块传输。暂存区在共享目录下的 `.vch-transfers-*` 专用目录，文件 Agent 每小时清理当前配对已闲置超过 48 小时的分块。重新配对后，可由本机管理员移除旧配对的暂存目录。整文件上传先核验 SHA-256 后发布；完整下载验证整文件，Range 下载验证所取分块。重试同一上传时，节点根据路径和摘要返回已保存的偏移量。结果未知的最终发布保留原有上传记录供核查。

切回 SSH 直连或重签管理 Agent 身份后，原文件凭据失效。需要重新切换并配对才能恢复访问。首次连接将配对固定到本机名和共享目录，更换任一项都需要重新配对。再次配对会撤销同一云盘的旧凭据。文件 Agent 只处理共享目录内的文件请求，单个目录最多列出 8192 项，目录过大时会显示错误并保留原有索引。共享目录应位于由可信本机账户管理的普通本地文件系统，子目录应继承相应的本机权限。

系统配置包会保存云盘与同团队服务器的关联。导入后需重新配对，若原服务器已删除，可先编辑云盘并选择当前团队的 Agent 服务器。
