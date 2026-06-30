/**
 * i18n dictionary: `sshTerminalModal.*` (21 keys).
 *
 * Used by:
 *   - src/components/ssh-terminal-modal.tsx (client component)
 *
 * Client-component pattern (ssh-terminal-modal.tsx):
 *   - `useI18n()` hook (React context) — `t("sshTerminalModal.statusConnected")` etc.
 *   - Tests use `renderWithI18n as render` from `@/lib/i18n/__tests__/test-helpers`.
 *
 * Template strings:
 *   - `title`: `SSH 终端 — {serverName}` (modal h3 + aria-labelledby)
 *   - `favoritesRemove`: `删除常用命令 {cmd}` (per-row aria-label)
 */
export const zh: Record<string, string> = {
	// Status badge (h3 sibling, role=status)
	"sshTerminalModal.statusConnected": "已连接",
	"sshTerminalModal.statusConnecting": "连接中",
	"sshTerminalModal.statusError": "连接失败",
	"sshTerminalModal.statusClosed": "已断开",

	// Header — title, panel toggle, reconnect, close
	"sshTerminalModal.title": "SSH 终端 — {serverName}",
	"sshTerminalModal.panelToggle": "📋 命令面板",
	"sshTerminalModal.panelToggleTitle": "命令面板",
	"sshTerminalModal.ariaClose": "关闭 SSH 终端",
	"sshTerminalModal.reconnect": "重连",
	"sshTerminalModal.close": "关闭",

	// WebSocket connection errors (setErrorMsg fallbacks)
	"sshTerminalModal.errTokenFetchFailed": "无法获取 SSH WebSocket 临时令牌，请重新登录后再试",
	"sshTerminalModal.errTokenEmpty": "SSH WebSocket 临时令牌为空，请检查服务配置",
	"sshTerminalModal.errUnknown": "未知错误",
	"sshTerminalModal.errClosed": "连接已关闭",
	"sshTerminalModal.errDisconnected": "WebSocket 连接已断开",
	"sshTerminalModal.errConnectionFailed": "WebSocket 连接失败，请确认 SSH 代理服务正在运行",

	// Terminal search
	"sshTerminalModal.searchLabel": "搜索终端输出",
	"sshTerminalModal.searchPlaceholder": "搜索终端输出…",
	"sshTerminalModal.searchPrevious": "上一个",
	"sshTerminalModal.searchNext": "下一个",
	"sshTerminalModal.searchClear": "清除",

	// Side panel — favorites (⭐ 常用命令)
	"sshTerminalModal.favoritesTitle": "⭐ 常用命令",
	"sshTerminalModal.favoritesLabel": "添加常用 SSH 命令",
	"sshTerminalModal.favoritesPlaceholder": "添加常用命令…",
	"sshTerminalModal.favoritesAdd": "添加常用命令",
	"sshTerminalModal.favoritesEmpty": "暂无常用命令",
	"sshTerminalModal.favoritesRemove": "删除常用命令 {cmd}",

	// Side panel — history (📜 命令历史)
	"sshTerminalModal.historyTitle": "📜 命令历史",
	"sshTerminalModal.historyEmpty": "暂无历史命令",

	// Side panel — quick commands (⚡ 快捷命令)
	"sshTerminalModal.quickCommandsTitle": "⚡ 快捷命令",

	// Multi-tab manager (TR-039)
	"sshTerminalManager.title": "SSH 终端",
	"sshTerminalManager.tabsSuffix": "个标签",
	"sshTerminalManager.closeTab": "关闭 {serverName} 标签",
	"sshTerminalManager.newTab": "新建标签",
};

export const en: Record<string, string> = {
	// Status badge (h3 sibling, role=status)
	"sshTerminalModal.statusConnected": "Connected",
	"sshTerminalModal.statusConnecting": "Connecting",
	"sshTerminalModal.statusError": "Connection failed",
	"sshTerminalModal.statusClosed": "Disconnected",

	// Header — title, panel toggle, reconnect, close
	"sshTerminalModal.title": "SSH Terminal — {serverName}",
	"sshTerminalModal.panelToggle": "📋 Command panel",
	"sshTerminalModal.panelToggleTitle": "Command panel",
	"sshTerminalModal.ariaClose": "Close SSH terminal",
	"sshTerminalModal.reconnect": "Reconnect",
	"sshTerminalModal.close": "Close",

	// WebSocket connection errors (setErrorMsg fallbacks)
	"sshTerminalModal.errTokenFetchFailed": "Failed to fetch SSH WebSocket token. Please sign in again.",
	"sshTerminalModal.errTokenEmpty": "SSH WebSocket token is empty. Please check the service configuration.",
	"sshTerminalModal.errUnknown": "Unknown error",
	"sshTerminalModal.errClosed": "Connection closed",
	"sshTerminalModal.errDisconnected": "WebSocket connection disconnected",
	"sshTerminalModal.errConnectionFailed": "WebSocket connection failed. Please confirm the SSH proxy service is running.",

	// Terminal search
	"sshTerminalModal.searchLabel": "Search terminal output",
	"sshTerminalModal.searchPlaceholder": "Search terminal output…",
	"sshTerminalModal.searchPrevious": "Previous",
	"sshTerminalModal.searchNext": "Next",
	"sshTerminalModal.searchClear": "Clear",

	// Side panel — favorites (⭐ Favorite commands)
	"sshTerminalModal.favoritesTitle": "⭐ Favorite commands",
	"sshTerminalModal.favoritesLabel": "Add favorite SSH command",
	"sshTerminalModal.favoritesPlaceholder": "Add a favorite command…",
	"sshTerminalModal.favoritesAdd": "Add favorite command",
	"sshTerminalModal.favoritesEmpty": "No favorite commands yet",
	"sshTerminalModal.favoritesRemove": "Remove favorite command {cmd}",

	// Side panel — history (📜 Command history)
	"sshTerminalModal.historyTitle": "📜 Command history",
	"sshTerminalModal.historyEmpty": "No history commands yet",

	// Side panel — quick commands (⚡ Quick commands)
	"sshTerminalModal.quickCommandsTitle": "⚡ Quick commands",

	// Multi-tab manager (TR-039)
	"sshTerminalManager.title": "SSH Terminal",
	"sshTerminalManager.tabsSuffix": "tabs",
	"sshTerminalManager.closeTab": "Close {serverName} tab",
	"sshTerminalManager.newTab": "New tab",
};
