"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";

export interface SearchItem {
	label: string;
	href: string;
	icon: string;
	category: string;
	keywords?: string[];
}

const searchItems: SearchItem[] = [
	{ label: "仪表盘", href: "/", icon: "📊", category: "页面" },
	{ label: "服务器管理", href: "/servers", icon: "🖥️", category: "页面" },
	{ label: "文件管理", href: "/storage", icon: "📁", category: "页面" },
	{ label: "下载站", href: "/downloads", icon: "📥", category: "页面" },
	{ label: "用户管理", href: "/users", icon: "👥", category: "页面" },
	{ label: "审计日志", href: "/audit", icon: "📋", category: "页面" },
	{ label: "Docker 容器", href: "/docker", icon: "🐳", category: "页面" },
	{ label: "AI 助手", href: "/ai", icon: "🤖", category: "页面" },
	{ label: "代码片段", href: "/snippets", icon: "💻", category: "页面" },
	{ label: "图床", href: "/image-bed", icon: "🖼️", category: "页面" },
	{ label: "快捷服务", href: "/quick-services", icon: "⚡", category: "页面", keywords: ["快服务", "quick service", "quick-services"] },
	{ label: "监控状态", href: "/monitoring", icon: "📡", category: "页面" },
	{ label: "备份恢复", href: "/backups", icon: "💾", category: "页面", keywords: ["backup", "备份迁移"] },
	{ label: "VPS 管理", href: "/servers", icon: "🔑", category: "工具", keywords: ["SSH 终端", "ssh", "服务器管理"] },
	{ label: "修改密码", href: "#password", icon: "🔐", category: "操作" },
	{ label: "两步验证", href: "#2fa", icon: "🛡️", category: "操作" },
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
			if (item.href.startsWith("#")) {
				// Dispatch custom events for modals
				if (item.href === "#password") window.dispatchEvent(new CustomEvent("open-password-modal"));
				if (item.href === "#2fa") window.dispatchEvent(new CustomEvent("open-2fa-modal"));
			} else {
				router.push(item.href);
			}
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
