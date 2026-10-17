/**
 * i18n dictionary: `sshTerminalModal.*` (48 keys) + `sshTerminalManager.*` (9 keys) + `sshFileManager.*` (21 keys).
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
	"sshTerminalModal.panelToggle": "命令面板",
	"sshTerminalModal.ariaClose": "关闭 SSH 终端",
	"sshTerminalModal.reconnect": "重连",
	"sshTerminalModal.close": "关闭",
	"sshTerminalModal.fullscreen": "全屏",
	"sshTerminalModal.fullscreenExit": "退出全屏",

	// WebSocket connection errors (setErrorMsg fallbacks)
	"sshTerminalModal.errTokenFetchFailed": "无法获取 SSH WebSocket 临时令牌，请重新登录后再试",
	"sshTerminalModal.errTokenEmpty": "SSH WebSocket 临时令牌为空，请检查服务配置",
	"sshTerminalModal.errUnknown": "未知错误",
	"sshTerminalModal.errClosed": "连接已关闭",
	"sshTerminalModal.errDisconnected": "WebSocket 连接已断开",
	"sshTerminalModal.errConnectionFailed": "WebSocket 连接失败，请确认 SSH 代理服务正在运行",
	"sshTerminalModal.errReplaced": "这个会话已在另一个窗口中继续。点“重连”可以在这里接回。",
	"sshTerminalModal.errInputTooLarge": "待发送内容超过 4 MiB，本次输入未发送。请分段粘贴或通过文件管理器上传。",

	// Terminal search
	"sshTerminalModal.errClipboardCopy": "复制失败：浏览器未允许写入剪贴板。选区已保留，请右键复制或检查浏览器权限后重试。",
	"sshTerminalModal.copyHint": "选中文字后按 Ctrl+C / Cmd+C 或 Ctrl+Shift+C 复制；程序接管鼠标时，按住 Shift 拖动选择。未选中文字时 Ctrl+C 仍为中断。",
	"sshTerminalModal.searchLabel": "搜索终端输出",
	"sshTerminalModal.searchPlaceholder": "搜索终端输出…",
	"sshTerminalModal.searchPrevious": "上一个",
	"sshTerminalModal.searchNext": "下一个",
	"sshTerminalModal.searchClear": "清除",

	// Side panel — favorites (⭐ 常用命令)
	"sshTerminalModal.favoritesTitle": "常用命令",
	"sshTerminalModal.favoritesLabel": "添加常用 SSH 命令",
	"sshTerminalModal.favoritesPlaceholder": "添加常用命令…",
	"sshTerminalModal.favoritesAdd": "添加常用命令",
	"sshTerminalModal.favoritesEmpty": "暂无常用命令",
	"sshTerminalModal.favoritesRemove": "删除常用命令 {cmd}",

	// Side panel — history (📜 命令历史)
	"sshTerminalModal.historyTitle": "命令历史",
	"sshTerminalModal.historyEmpty": "暂无历史命令",

	// Side panel — quick commands (⚡ 快捷命令)
	"sshTerminalModal.quickCommandsTitle": "快捷命令",

	// Side panel — quick keys (⌨ 快捷按键：Ctrl+C、方向键等，原样发送不附加回车)
	"sshTerminalModal.quickKeysTitle": "快捷按键",

	// Side panel — custom quick key presets (⌨ 自定义组合键：Ctrl/Shift/Alt + 键)
	"sshTerminalModal.quickKeysCustomize": "自定义组合键",
	"sshTerminalModal.quickKeysClose": "关闭自定义组合键",
	"sshTerminalModal.quickKeysPickKey": "选择按键",
	"sshTerminalModal.quickKeysAdd": "添加",
	"sshTerminalModal.quickKeysResetHint": "已添加自定义按键，",
	"sshTerminalModal.quickKeysReset": "恢复默认",

	// Side panel — display (终端字号，保存在当前浏览器)
	"sshTerminalModal.fontSizeTitle": "终端字号",
	"sshTerminalModal.fontSizeDecrease": "缩小终端字号",
	"sshTerminalModal.fontSizeIncrease": "放大终端字号",

	// Side panel — connection (中断后保留会话，由代理在服务端保持 shell)
	"sshTerminalModal.keepAliveTitle": "连接",
	"sshTerminalModal.keepAliveLabel": "中断后保留会话",
	"sshTerminalModal.keepAliveHint": "网络中断、手机锁屏或刷新页面后，{minutes} 分钟内重连会接回原来的会话：远端程序继续运行，期间的输出不会丢失。点“关闭”会结束会话。",
	"sshTerminalModal.sessionResumed": "已接回中断前的会话。",
	"sshTerminalModal.sessionFresh": "已重新建立会话，之前的进程已结束。",
	"sshTerminalModal.sessionFreshLine": "—— 新会话 ——",
	"sshTerminalModal.sessionResumedPartial": "已接回中断前的会话；断开期间输出较多，只补发了最近的一部分。",
	"sshTerminalModal.strayMouseOff": "鼠标操作被远端当作文字输入（打开鼠标模式的程序可能已异常退出），已在本地关闭鼠标上报。",
	"sshTerminalModal.selectHint": "当前程序接管了鼠标：按住 Shift 拖动选中文字，再右键复制（Mac 上按住 Option）。",
	"sshTerminalModal.autoReconnectIn": "{seconds} 秒后自动重连",
	"sshTerminalModal.terminalStateTitle": "终端状态",
	"sshTerminalModal.resetTerminal": "重置终端状态",
	"sshTerminalModal.resetTerminalHint": "程序异常退出后，如果移动鼠标或滚动出现乱码、光标消失，点此恢复；只重置本页终端，不向服务器发送任何内容。",

	// Multi-tab manager (TR-039)
	"sshTerminalManager.title": "SSH 终端",
	"sshTerminalManager.tabsSuffix": "个标签",
	"sshTerminalManager.closeTab": "关闭 {serverName} 标签",
	"sshTerminalManager.minimize": "最小化",
	"sshTerminalManager.expand": "展开",
	"sshTerminalManager.resizeHandle": "拖动调整 SSH 终端高度",
	"sshTerminalManager.closeAllTitle": "关闭全部终端会话？",
	"sshTerminalManager.closeAllDescription": "即将断开 {count} 个 SSH 会话（包括正在运行的进程与回滚内容），且无法恢复。",
	"sshTerminalManager.closeAllConfirm": "全部关闭",

	// File manager (SFTP)
	"sshFileManager.toggle": "文件",
	"sshFileManager.title": "远程文件",
	"sshFileManager.upload": "上传",
	"sshFileManager.download": "下载",
	"sshFileManager.delete": "删除",
	"sshFileManager.rename": "重命名",
	"sshFileManager.newFolder": "新建文件夹",
	"sshFileManager.folderName": "文件夹名称…",
	"sshFileManager.dropHere": "拖放文件到此处上传",
	"sshFileManager.dragHint": "拖放文件到此处上传",
	"sshFileManager.loading": "加载中…",
	"sshFileManager.empty": "空目录",
	"sshFileManager.upLevel": "上一层",
	"sshFileManager.upLevelAria": "返回上一层目录",
	"sshFileManager.confirmDelete": "确定删除 {name}？",
	"sshFileManager.uploadFailed": "上传失败（{status}）",
	"sshFileManager.networkError": "上传时网络错误",
	"sshFileManager.listFailed": "无法列出目录",
	"sshFileManager.deleteFailed": "删除失败",
	"sshFileManager.mkdirFailed": "创建文件夹失败",
	"sshFileManager.renameFailed": "重命名失败",
};

export const en: Record<string, string> = {
	// Status badge (h3 sibling, role=status)
	"sshTerminalModal.statusConnected": "Connected",
	"sshTerminalModal.statusConnecting": "Connecting",
	"sshTerminalModal.statusError": "Connection failed",
	"sshTerminalModal.statusClosed": "Disconnected",
	"sshTerminalModal.panelToggle": "Command panel",
	"sshTerminalModal.ariaClose": "Close SSH terminal",
	"sshTerminalModal.reconnect": "Reconnect",
	"sshTerminalModal.close": "Close",
	"sshTerminalModal.fullscreen": "Fullscreen",
	"sshTerminalModal.fullscreenExit": "Exit fullscreen",

	// WebSocket connection errors (setErrorMsg fallbacks)
	"sshTerminalModal.errTokenFetchFailed": "Failed to fetch SSH WebSocket token. Please sign in again.",
	"sshTerminalModal.errTokenEmpty": "SSH WebSocket token is empty. Please check the service configuration.",
	"sshTerminalModal.errUnknown": "Unknown error",
	"sshTerminalModal.errClosed": "Connection closed",
	"sshTerminalModal.errDisconnected": "WebSocket connection disconnected",
	"sshTerminalModal.errConnectionFailed": "WebSocket connection failed. Please confirm the SSH proxy service is running.",
	"sshTerminalModal.errReplaced": "This session continued in another window. Reconnect to take it back here.",
	"sshTerminalModal.errInputTooLarge": "Pending input exceeds 4 MiB. This input was not sent. Paste smaller sections or upload through the file manager.",

	// Terminal search
	"sshTerminalModal.errClipboardCopy": "Copy failed: the browser did not allow clipboard access. Your selection is preserved. Try right-click Copy or check browser permissions and retry.",
	"sshTerminalModal.copyHint": "Select text, then Ctrl+C / Cmd+C or Ctrl+Shift+C to copy. Hold Shift while dragging if a program captures the mouse. With no selection, Ctrl+C still interrupts.",
	"sshTerminalModal.searchLabel": "Search terminal output",
	"sshTerminalModal.searchPlaceholder": "Search terminal output…",
	"sshTerminalModal.searchPrevious": "Previous",
	"sshTerminalModal.searchNext": "Next",
	"sshTerminalModal.searchClear": "Clear",

	// Side panel — favorites (⭐ Favorite commands)
	"sshTerminalModal.favoritesTitle": "Favorite commands",
	"sshTerminalModal.favoritesLabel": "Add favorite SSH command",
	"sshTerminalModal.favoritesPlaceholder": "Add a favorite command…",
	"sshTerminalModal.favoritesAdd": "Add favorite command",
	"sshTerminalModal.favoritesEmpty": "No favorite commands yet",
	"sshTerminalModal.favoritesRemove": "Remove favorite command {cmd}",

	// Side panel — history (📜 Command history)
	"sshTerminalModal.historyTitle": "Command history",
	"sshTerminalModal.historyEmpty": "No history commands yet",

	// Side panel — quick commands (⚡ Quick commands)
	"sshTerminalModal.quickCommandsTitle": "Quick commands",

	// Side panel — quick keys (⌨ sent raw without appending Enter)
	"sshTerminalModal.quickKeysTitle": "Quick keys",

	// Side panel — custom quick key presets (⌨ composable Ctrl/Shift/Alt + key)
	"sshTerminalModal.quickKeysCustomize": "Custom key",
	"sshTerminalModal.quickKeysClose": "Close custom key builder",
	"sshTerminalModal.quickKeysPickKey": "Pick a key",
	"sshTerminalModal.quickKeysAdd": "Add",
	"sshTerminalModal.quickKeysResetHint": "Custom keys added, ",
	"sshTerminalModal.quickKeysReset": "reset to defaults",

	// Side panel — display (terminal font size, kept in this browser)
	"sshTerminalModal.fontSizeTitle": "Terminal font size",
	"sshTerminalModal.fontSizeDecrease": "Smaller terminal font",
	"sshTerminalModal.fontSizeIncrease": "Larger terminal font",

	// Side panel — connection (keep the shell on the proxy across a dropped socket)
	"sshTerminalModal.keepAliveTitle": "Connection",
	"sshTerminalModal.keepAliveLabel": "Keep the session after a disconnect",
	"sshTerminalModal.keepAliveHint": "After a network drop, a locked phone screen or a page reload, reconnecting within {minutes} minutes picks the same session up: the remote program keeps running and nothing it printed is lost. Close ends the session.",
	"sshTerminalModal.sessionResumed": "Resumed the session from before the disconnect.",
	"sshTerminalModal.sessionFresh": "Started a new session; the previous shell has ended.",
	"sshTerminalModal.sessionFreshLine": "—— new session ——",
	"sshTerminalModal.sessionResumedPartial": "Resumed the session. It printed a lot while disconnected, so only the latest output was replayed.",
	"sshTerminalModal.strayMouseOff": "The remote side took mouse actions as typed text (the program that turned mouse reporting on may have died), so mouse reporting was turned off here.",
	"sshTerminalModal.selectHint": "This program captures the mouse: hold Shift while dragging to select text, then right-click to copy (Option on a Mac).",
	"sshTerminalModal.autoReconnectIn": "Reconnecting in {seconds} s",
	"sshTerminalModal.terminalStateTitle": "Terminal state",
	"sshTerminalModal.resetTerminal": "Reset terminal state",
	"sshTerminalModal.resetTerminalHint": "If a program quit abnormally and mouse moves or scrolling print garbage, or the cursor is gone, use this. Only this page's terminal is reset; nothing is sent to the server.",

	// Multi-tab manager (TR-039)
	"sshTerminalManager.title": "SSH Terminal",
	"sshTerminalManager.tabsSuffix": "tabs",
	"sshTerminalManager.closeTab": "Close {serverName} tab",
	"sshTerminalManager.minimize": "Minimize",
	"sshTerminalManager.expand": "Expand",
	"sshTerminalManager.resizeHandle": "Drag to resize the SSH terminal",
	"sshTerminalManager.closeAllTitle": "Close all terminal sessions?",
	"sshTerminalManager.closeAllDescription": "This disconnects {count} SSH sessions (including running processes and scrollback) and cannot be undone.",
	"sshTerminalManager.closeAllConfirm": "Close all",

	// File manager (SFTP)
	"sshFileManager.toggle": "Files",
	"sshFileManager.title": "Remote Files",
	"sshFileManager.upload": "Upload",
	"sshFileManager.download": "Download",
	"sshFileManager.delete": "Delete",
	"sshFileManager.rename": "Rename",
	"sshFileManager.newFolder": "New Folder",
	"sshFileManager.folderName": "Folder name…",
	"sshFileManager.dropHere": "Drop files here to upload",
	"sshFileManager.dragHint": "Drop files here to upload",
	"sshFileManager.loading": "Loading…",
	"sshFileManager.empty": "Empty directory",
	"sshFileManager.upLevel": "Up",
	"sshFileManager.upLevelAria": "Go to parent directory",
	"sshFileManager.confirmDelete": "Delete {name}?",
	"sshFileManager.uploadFailed": "Upload failed ({status})",
	"sshFileManager.networkError": "Network error during upload",
	"sshFileManager.listFailed": "Failed to list directory",
	"sshFileManager.deleteFailed": "Delete failed",
	"sshFileManager.mkdirFailed": "Failed to create folder",
	"sshFileManager.renameFailed": "Rename failed",
};
