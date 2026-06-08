"use client";

import { useEffect, useState, useRef, useCallback, useMemo } from "react";
import { useRouter } from "next/navigation";
import { mainNavItems, systemNavItems } from "./nav-items";
import { useI18n } from "@/lib/i18n/use-locale";
import { t as translate, type Locale } from "@/lib/i18n/translations";

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
	"/quick-services": { icon: "⚡", keywords: ["快服务", "quick service", "quick services", "quick-services", "quick apps", "应用商店"] },
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

type SearchItemDefinition = Omit<SearchItem, "label" | "category"> & {
	labelKey: string;
	fallbackLabel: string;
	categoryKey: string;
	fallbackCategory: string;
};

const navigationSearchItems: SearchItemDefinition[] = [...mainNavItems, ...systemNavItems].map((item) => {
	const metadata = searchItemMetadata[item.href] ?? {};
	return {
		labelKey: item.labelKey,
		fallbackLabel: item.fallbackLabel,
		href: item.href,
		icon: metadata.icon ?? "🔎",
		categoryKey: item.href === "/status" ? "search.category.public" : item.href === "/users" || item.href === "/api-tokens" || item.href === "/audit" ? "search.category.system" : "search.category.page",
		fallbackCategory: item.href === "/status" ? "公开页面" : item.href === "/users" || item.href === "/api-tokens" || item.href === "/audit" ? "系统" : "页面",
		keywords: [item.labelKey, ...(metadata.keywords ?? [])],
	};
});

const searchItemDefinitions: SearchItemDefinition[] = [
	...navigationSearchItems,
	{ labelKey: "nav.ssh", fallbackLabel: "SSH 终端", href: "/servers", icon: "🔑", categoryKey: "search.category.tool", fallbackCategory: "工具", keywords: ["ssh", "终端", "VPS 管理", "服务器管理"] },
	{ labelKey: "auth.change-password", fallbackLabel: "修改密码", href: "/settings#password", icon: "🔐", categoryKey: "search.category.action", fallbackCategory: "操作", keywords: ["密码", "password", "账户安全"] },
	{ labelKey: "auth.two-factor", fallbackLabel: "两步验证", href: "/settings#2fa", icon: "🛡️", categoryKey: "search.category.action", fallbackCategory: "操作", keywords: ["2FA", "MFA", "双因素", "账户安全"] },
];

function localizeSearchItems(locale: Locale): SearchItem[] {
	return searchItemDefinitions.map((item) => ({
		label: translate(item.labelKey, locale) === item.labelKey ? item.fallbackLabel : translate(item.labelKey, locale),
		href: item.href,
		icon: item.icon,
		category: translate(item.categoryKey, locale) === item.categoryKey ? item.fallbackCategory : translate(item.categoryKey, locale),
		keywords: item.keywords,
	}));
}

export function getSearchItems(locale: Locale = "zh"): SearchItem[] {
	return localizeSearchItems(locale);
}

export function GlobalSearch({ externalOpenSignal = 0 }: { externalOpenSignal?: number }) {
	const [open, setOpen] = useState(false);
	const [query, setQuery] = useState("");
	const [selectedIndex, setSelectedIndex] = useState(0);
	const inputRef = useRef<HTMLInputElement>(null);
	const router = useRouter();
	const { locale, t } = useI18n();
	const searchItems = useMemo(() => localizeSearchItems(locale), [locale]);

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
		if (externalOpenSignal > 0) {
			setOpen(true);
		}
	}, [externalOpenSignal]);

	useEffect(() => {
		const handleOpenSearch = () => setOpen(true);
		window.addEventListener("vcontrolhub:open-global-search", handleOpenSearch);
		return () => window.removeEventListener("vcontrolhub:open-global-search", handleOpenSearch);
	}, []);

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
		<div className="fixed inset-0 z-[70] flex items-start justify-center pt-[15vh] bg-black/60 light:bg-slate-900/60 backdrop-blur-sm" onClick={() => { setOpen(false); setQuery(""); }}>
			<div
				role="dialog"
				aria-modal="true"
				aria-label={t("search.dialog")}
				className="w-full max-w-lg mx-4 bg-slate-950 light:bg-white border border-white/[0.08] rounded-2xl shadow-2xl overflow-hidden"
				onClick={(e) => e.stopPropagation()}
			>
				<div className="flex items-center px-4 border-b border-white/[0.06]">
					<svg className="w-4 h-4 text-slate-500 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
						<path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
					</svg>
					<input
						ref={inputRef}
						type="text"
						role="combobox"
						aria-label={t("search.input-label")}
						aria-expanded="true"
						aria-controls="global-search-results"
						aria-activedescendant={filtered[selectedIndex] ? `global-search-result-${selectedIndex}`: undefined} aria-autocomplete="list" value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={handleKeyDown} placeholder={t("search.placeholder")} className="flex-1 bg-transparent px-3 py-3.5 text-sm text-white light:text-slate-900 placeholder-slate-600 focus:outline-none" /> <kbd className="text-[10px] text-slate-600 bg-white/[0.05] rounded px-1.5 py-0.5">ESC</kbd> </div> <ul id="global-search-results" role="listbox" className="max-h-72 overflow-y-auto py-2"> {filtered.length === 0 && ( <li className="px-4 py-6 text-center text-sm text-slate-600">{t("search.no-results")}</li> )} {filtered.map((item, i) => ( <li key={item.href + item.label} id={`global-search-result-${i}`} role="option" aria-selected={i === selectedIndex}>
							<button
								onClick={() => navigate(item)}
								className={`w-full flex items-center gap-3 px-4 py-2.5 text-sm transition ${
									i === selectedIndex ?"bg-white/[0.06] text-white light:text-slate-900" :"text-slate-400 light:text-slate-600 hover:bg-white/[0.03]"
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
					<span>{t("search.shortcut-select")}</span>
					<span>{t("search.shortcut-confirm")}</span>
					<span>{t("search.shortcut-close")}</span>
				</div>
			</div>
		</div>
	);
}
