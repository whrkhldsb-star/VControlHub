"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import { mainNavItems, systemNavItems } from "./nav-items";

export interface SearchItem {
	label: string;
	href: string;
	icon: string;
	category: string;
	keywords?: string[];
}

const searchItemMetadata: Record<string, Pick<SearchItem, "icon" | "keywords">> = {
	"/": { icon: "📊", keywords: ["dashboard", "首页", "概览"] },
	"/servers": { icon: "🖥️", keywords: ["vps", "ssh", "终端", "服务器"] },
	"/health": { icon: "💚", keywords: ["系统自检", "系统健康", "health", "system health"] },
	"/traffic": { icon: "📈", keywords: ["流量", "带宽", "traffic"] },
	"/files": { icon: "📁", keywords: ["storage", "存储", "云盘", "sftp"] },
	"/downloads": { icon: "📥", keywords: ["下载站", "远程下载", "download"] },
	"/operation-tasks": { icon: "🧾", keywords: ["任务中心", "后台任务", "task"] },
	"/shares": { icon: "🔗", keywords: ["分享", "外链", "share"] },
	"/backups": { icon: "💾", keywords: ["backup", "备份迁移", "恢复", "restore"] },
	"/templates": { icon: "🧩", keywords: ["命令模板", "template", "command"] },
	"/deployments": { icon: "🚀", keywords: ["部署", "deploy", "发布"] },
	"/quick-services": { icon: "⚡", keywords: ["快服务", "quick service", "quick-services", "应用商店"] },
	"/snippets": { icon: "💻", keywords: ["代码片段", "snippet"] },
	"/media": { icon: "🎞️", keywords: ["媒体库", "media"] },
	"/image-bed": { icon: "🖼️", keywords: ["图床", "图片", "image"] },
	"/ai": { icon: "🤖", keywords: ["AI 助手", "模型", "provider"] },
	"/announcements": { icon: "📣", keywords: ["公告", "站内公告"] },
	"/tickets": { icon: "🎫", keywords: ["工单", "请求", "ticket"] },
	"/requests": { icon: "✅", keywords: ["审批", "approval", "requests"] },
	"/scheduled-tasks": { icon: "⏰", keywords: ["定时任务", "计划任务", "cron"] },
	"/alert-rules": { icon: "🚨", keywords: ["告警", "alert", "规则"] },
	"/notifications": { icon: "🔔", keywords: ["通知", "消息", "notification"] },
	"/settings": { icon: "⚙️", keywords: ["系统设置", "账户安全", "会话", "SMTP"] },
	"/users": { icon: "👥", keywords: ["用户", "角色", "权限"] },
	"/api-tokens": { icon: "🔑", keywords: ["API Token", "令牌", "token"] },
	"/status": { icon: "📡", keywords: ["公开状态页", "status"] },
	"/audit": { icon: "📋", keywords: ["审计", "日志", "audit"] },
};

const navigationSearchItems: SearchItem[] = [...mainNavItems, ...systemNavItems].map((item) => {
	const metadata = searchItemMetadata[item.href] ?? {};
	return {
		label: item.fallbackLabel,
		href: item.href,
		icon: metadata.icon ?? "🔎",
		category: item.href === "/status" ? "公开页面" : item.href === "/users" || item.href === "/api-tokens" || item.href === "/audit" ? "系统" : "页面",
		keywords: [item.labelKey, ...(metadata.keywords ?? [])],
	};
});

const searchItems: SearchItem[] = [
	...navigationSearchItems,
	{ label: "SSH 终端", href: "/servers", icon: "🔑", category: "工具", keywords: ["ssh", "终端", "VPS 管理", "服务器管理"] },
	{ label: "修改密码", href: "/settings#password", icon: "🔐", category: "操作", keywords: ["密码", "password", "账户安全"] },
	{ label: "两步验证", href: "/settings#2fa", icon: "🛡️", category: "操作", keywords: ["2FA", "MFA", "双因素", "账户安全"] },
];

export function getSearchItems(): SearchItem[] {
	return searchItems;
}

export function GlobalSearch() {
	const [open, setOpen] = useState(false);
	const [query, setQuery] = useState("");
	const [selectedIndex, setSelectedIndex] = useState(0);
	const inputRef = useRef<HTMLInputElement>(null);
	const router = useRouter();

	const filtered = query
		? searchItems.filter(
				(item) => {
					const normalizedQuery = query.toLowerCase();
					return (
						item.label.toLowerCase().includes(normalizedQuery) ||
						item.category.toLowerCase().includes(normalizedQuery) ||
						(item.keywords ?? []).some((keyword) => keyword.toLowerCase().includes(normalizedQuery))
					);
				}
			)
		: searchItems;

	const navigate = useCallback(
		(item: SearchItem) => {
			setOpen(false);
			setQuery("");
			router.push(item.href);
		},
		[router]
	);

	useEffect(() => {
		const handleKeyDown = (e: KeyboardEvent) => {
			if ((e.metaKey || e.ctrlKey) && e.key === "k") {
				e.preventDefault();
				setOpen((v) => !v);
			}
			if (e.key === "Escape" && open) {
				setOpen(false);
				setQuery("");
			}
		};
		window.addEventListener("keydown", handleKeyDown);
		return () => window.removeEventListener("keydown", handleKeyDown);
	}, [open]);

	useEffect(() => {
		if (open) {
			setTimeout(() => inputRef.current?.focus(), 50);

			setSelectedIndex(0);
		}
	}, [open]);



	useEffect(() => {
		setSelectedIndex(0);
	}, [query]);

	const handleKeyDown = (e: React.KeyboardEvent) => {
		if (e.key === "ArrowDown") {
			e.preventDefault();
			setSelectedIndex((i) => Math.min(i + 1, filtered.length - 1));
		} else if (e.key === "ArrowUp") {
			e.preventDefault();
			setSelectedIndex((i) => Math.max(i - 1, 0));
		} else if (e.key === "Enter" && filtered[selectedIndex]) {
			navigate(filtered[selectedIndex]);
		}
	};

	if (!open) return null;

	return (
		<div className="fixed inset-0 z-[70] flex items-start justify-center pt-[15vh] bg-black/60 backdrop-blur-sm" onClick={() => { setOpen(false); setQuery(""); }}>
			<div className="w-full max-w-lg mx-4 bg-slate-950 border border-white/[0.08] rounded-2xl shadow-2xl overflow-hidden" onClick={(e) => e.stopPropagation()}>
				<div className="flex items-center px-4 border-b border-white/[0.06]">
					<svg className="w-4 h-4 text-slate-500 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
						<path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
					</svg>
					<input
						ref={inputRef}
						type="text"
						value={query}
						onChange={(e) => setQuery(e.target.value)}
						onKeyDown={handleKeyDown}
						placeholder="搜索页面、操作..."
						className="flex-1 bg-transparent px-3 py-3.5 text-sm text-white placeholder-slate-600 focus:outline-none"
					/>
					<kbd className="text-[10px] text-slate-600 bg-white/[0.05] rounded px-1.5 py-0.5">ESC</kbd>
				</div>
				<ul className="max-h-72 overflow-y-auto py-2">
					{filtered.length === 0 && (
						<li className="px-4 py-6 text-center text-sm text-slate-600">未找到结果</li>
					)}
					{filtered.map((item, i) => (
						<li key={item.href + item.label}>
							<button
								onClick={() => navigate(item)}
								className={`w-full flex items-center gap-3 px-4 py-2.5 text-sm transition ${
									i === selectedIndex ? "bg-white/[0.06] text-white" : "text-slate-400 hover:bg-white/[0.03]"
								}`}
							>
								<span className="text-base">{item.icon}</span>
								<span className="flex-1 text-left">{item.label}</span>
								<span className="text-[10px] text-slate-600">{item.category}</span>
							</button>
						</li>
					))}
				</ul>
				<div className="border-t border-white/[0.06] px-4 py-2 flex items-center gap-4 text-[10px] text-slate-600">
					<span>↑↓ 选择</span>
					<span>↵ 确认</span>
					<span>ESC 关闭</span>
				</div>
			</div>
		</div>
	);
}
