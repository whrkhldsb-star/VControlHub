/**
 * i18n dictionary: server-side hardening copy for the SSH/command domain
 * (SSH executors, host-key handling, docker/compose paths).
 *
 * Domain-owned by the SSH/command area — only SSH/command-area changes add
 * keys here, which keeps parallel edits off the shared service-translations.ts
 * barrel.
 */
export const zh: Record<string, string> = {
	// ── Host-key pinning (fail-closed connection refusals) ────────────────
	"backend.ssh.hostKeyNotPinned":
		"该节点尚未固定 SSH 主机密钥指纹，已拒绝连接。请先在节点设置中验证并固定主机指纹后重试。",
	"backend.ssh.hostKeyApprovalRequired":
		"首次连接需要确认 SSH 主机指纹：{fingerprint}。请勾选“我已验证并信任该 SSH 主机指纹”后重新提交。",
	"backend.ssh.hostKeyChanged":
		"SSH 主机指纹与已保存记录不一致，连接已被阻止。已保存：{expected}；当前：{actual}。这可能意味着服务器重装或存在中间人攻击，请核实后再更新指纹。",

	// ── SSH client / connection lifecycle ─────────────────────────────────
	"backend.ssh.reconnectPaused": "连接失败后 SSH 暂时停止重连：{message}",
	"backend.ssh.connectionTimedOut": "SSH 连接超时",
	"backend.ssh.sftpSubsystemError": "SFTP 子系统错误：{message}",

	// ── SSH terminal WebSocket proxy (messages sent straight to browser) ──
	"backend.sshTerminal.missingParams": "缺少 serverId、会话或 handshake 参数",
	"backend.sshTerminal.authFailed": "认证失败，请重新登录",
	"backend.sshTerminal.permissionDenied": "缺少 SSH 终端使用权限",
	"backend.sshTerminal.connectionInfoDecryptFailed":
		"无法解密或读取 VPS 连接信息，请检查节点凭据配置",
	"backend.sshTerminal.connectionInfoMissing": "无法获取 VPS 连接信息，请检查节点配置",
	"backend.sshTerminal.originNotAllowed": "来源不受信任，已拒绝连接",
	"backend.sshTerminal.handshakeTokenInvalid": "SSH 终端临时令牌无效或已过期，请刷新页面重试",
	"backend.sshTerminal.idleClosed": "会话因 {minutes} 分钟无操作已自动关闭",
	"backend.sshTerminal.connectionClosed": "SSH 连接已关闭",
	"backend.sshTerminal.shellCreationFailed": "创建 Shell 失败：{message}",
	"backend.ssh.uploadStalled": "SFTP 上传停滞（{seconds} 秒无数据传输），已中止",
	"backend.ssh.downloadStalled": "SFTP 下载停滞（{seconds} 秒无数据传输），已中止",

	// ── Command execution (messages surfaced to the requesting client) ────
	"backend.command.sshpassMissing":
		"密码连接需要 sshpass 工具，但系统未安装 sshpass。请安装 sshpass 或改用 SSH 密钥连接。",
	"backend.command.sshKeyLacksPrivateKey":
		"节点 {name} 绑定的 SSH 密钥缺少私钥，无法执行真实 SSH 命令。",
	"backend.command.passwordMissing":
		"节点 {name} 配置为密码连接但未配置密码，无法执行真实 SSH 命令。",
	"backend.command.hostKeyNotPinnedRefused":
		"节点 {name} 未固定 SSH 主机密钥指纹，已拒绝在未校验主机密钥的情况下执行命令。请先在节点设置中验证并固定主机指纹后重试。",
};

export const en: Record<string, string> = {
	// ── Host-key pinning (fail-closed connection refusals) ────────────────
	"backend.ssh.hostKeyNotPinned":
		"This server has no pinned SSH host key fingerprint; connection refused. Verify and pin the host fingerprint in the server settings first.",
	"backend.ssh.hostKeyApprovalRequired":
		"First connection requires confirming the SSH host fingerprint: {fingerprint}. Please check \"I have verified and trust this SSH host fingerprint\" and resubmit.",
	"backend.ssh.hostKeyChanged":
		"The SSH host fingerprint does not match the saved record; connection blocked. Saved: {expected}; current: {actual}. This may indicate a server reinstall or man-in-the-middle attack; please verify before updating the fingerprint.",

	// ── SSH client / connection lifecycle ─────────────────────────────────
	"backend.ssh.reconnectPaused": "SSH reconnect temporarily paused after a connection failure: {message}",
	"backend.ssh.connectionTimedOut": "SSH connection timed out",
	"backend.ssh.sftpSubsystemError": "SFTP subsystem error: {message}",

	// ── SSH terminal WebSocket proxy (messages sent straight to browser) ──
	"backend.sshTerminal.missingParams": "Missing serverId, session, or handshake parameter",
	"backend.sshTerminal.authFailed": "Authentication failed, please log in again",
	"backend.sshTerminal.permissionDenied": "Missing SSH terminal permission",
	"backend.sshTerminal.connectionInfoDecryptFailed":
		"Unable to decrypt or read VPS connection info, please check the server credential configuration",
	"backend.sshTerminal.connectionInfoMissing": "Unable to get VPS connection info, please check the server configuration",
	"backend.sshTerminal.originNotAllowed": "Origin not allowed; connection refused",
	"backend.sshTerminal.handshakeTokenInvalid": "SSH terminal temporary token is invalid or expired; refresh the page and retry",
	"backend.sshTerminal.idleClosed": "Session closed after {minutes} min of inactivity",
	"backend.sshTerminal.connectionClosed": "SSH connection closed",
	"backend.sshTerminal.shellCreationFailed": "Shell creation failed: {message}",
	"backend.ssh.uploadStalled": "SFTP upload stalled (no data for {seconds}s); aborted",
	"backend.ssh.downloadStalled": "SFTP download stalled (no data for {seconds}s); aborted",

	// ── Command execution (messages surfaced to the requesting client) ────
	"backend.command.sshpassMissing":
		"Password connection requires the sshpass tool, but sshpass is not installed on the system. Please install sshpass or switch to SSH key connection.",
	"backend.command.sshKeyLacksPrivateKey":
		"The SSH key bound to node {name} lacks a private key; cannot execute real SSH command.",
	"backend.command.passwordMissing":
		"Node {name} is configured for password connection but lacks a password; cannot execute real SSH command.",
	"backend.command.hostKeyNotPinnedRefused":
		"Node {name} has no pinned SSH host key; refusing to execute without host-key verification. Please verify and pin the host fingerprint in the server settings first.",
};
