import { zh as remoteDesktopZh, en as remoteDesktopEn } from "./remote-desktop";
import { zh as zhEntries } from "./servers-zh";
import { en as enEntries } from "./servers-en";

export const zh: Record<string, string> = {
	"serversPage.desktopModes": "使用 RDP 打开 Windows 桌面。通过文件 Agent 或 SFTP 将存储位置连接为云盘。",
	"serversPage.terminalModes": "使用 SSH 打开 Linux 终端或运行命令。节点 Agent 主动连接控制台以接受管理。",
	"serversPage.connectionGuide": "如何选择连接方式",
	"serversPage.readEmpty": "你的账户暂时没有可用服务器。请联系管理员申请访问权限。",
	...zhEntries,
	...remoteDesktopZh,
};

export const en: Record<string, string> = {
	"serversPage.desktopModes": "Use RDP for a Windows desktop. File Agent or SFTP connects storage locations as drives.",
	"serversPage.terminalModes": "Use SSH for a Linux terminal or commands. The node Agent connects outbound for management.",
	"serversPage.connectionGuide": "Choosing a connection mode",
	"serversPage.readEmpty": "No servers are available to your account yet. Ask an administrator for access.",
	...enEntries,
	...remoteDesktopEn,
};
