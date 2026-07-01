"use client";

import { useEffect, useState, useRef, useCallback, useMemo } from "react";
import { useRouter } from "next/navigation";
import { mainNavItems, systemNavItems } from "./nav-items";
import { useI18n } from "@/lib/i18n/use-locale";
import { t as translate, type Locale } from "@/lib/i18n/translations";
import { type Permission } from "@/lib/auth/rbac";
import { useGateRoute } from "@/lib/auth/use-gate-route";

export interface SearchItem {
	label: string;
	href: string;
	icon: string;
	category: string;
	keywords?: string[];
}

type DynamicSearchResponse = {
	results?: SearchItem[];
};

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
	"/settings": { icon: "⚙️", keywords: ["设置", "偏好设置", "系统设置", "个人偏好", "账户安全", "会话", "SMTP"] },
	"/users": { icon: "👥", keywords: ["用户", "角色", "权限"] },
	"/api-tokens": { icon: "🔑", keywords: ["API Token", "令牌", "token"] },
	"/status": { icon: "📡", keywords: ["公开状态页", "status"] },
	"/audit": { icon: "📋", keywords: ["审计", "日志", "audit"] },
	"/qa-reports": { icon: "🧪", keywords: ["QA 报告", "维护环", "QA loop", "evidence"] },
};

type SearchItemDefinition = Omit<SearchItem, "label" | "category"> & {
	labelKey: string;
	fallbackLabel: string;
	categoryKey: string;
	fallbackCategory: string;
};

const navigationSearchItems: SearchItemDefinition[] = [...mainNavItems, ...systemNavItems].map((item) => {
	const metadata = searchItemMetadata[item.href] ?? ({} as Pick<SearchItem, "icon" | "keywords">);
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
	{ labelKey: "preferencesPage.category.personal.title", fallbackLabel: "个人偏好", href: "/settings#personal-preferences", icon: "👤", categoryKey: "search.category.action", fallbackCategory: "操作", keywords: ["偏好设置", "默认页面", "仪表盘组件", "通知", "自动刷新"] },
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

/**
 * Filter search items against the user session's permission gate.
 *
 * Items with no declared permissions (or declared empty array) are visible to
 * any authenticated user. Items with declared permissions are kept only when
 * the user holds at least one (`canAny`). Mirrors the sidebar's
 * permission-gated render contract (TR-030 / task 56).
 */
function filterItemsByPermissions(
	items: readonly SearchItem[],
	declaredPermissionsByHref: Record<string, readonly Permission[]>,
	canAny: (permissions: readonly Permission[]) => boolean,
): SearchItem[] {
	return items.filter((item) => {
		const required = declaredPermissionsByHref[item.href];
		if (!required || required.length === 0) return true;
		return canAny(required);
	});
}

export function GlobalSearch({
	externalOpenSignal = 0,
	declaredPermissionsByHref = {},
}: {
	externalOpenSignal?: number;
	declaredPermissionsByHref?: Record<string, readonly Permission[]>;
}) {
	const [open, setOpen] = useState(false);
	const [query, setQuery] = useState("");
	const [dynamicResults, setDynamicResults] = useState<SearchItem[]>([]);
	const [selectedIndex, setSelectedIndex] = useState(0);
	const inputRef = useRef<HTMLInputElement>(null);
	const returnFocusRef = useRef<HTMLElement | null>(null);
	const router = useRouter();
	const { locale, t } = useI18n();
	const gate = useGateRoute();
	const searchItems = useMemo(
		() => filterItemsByPermissions(localizeSearchItems(locale), declaredPermissionsByHref, gate.canAny),
		[locale, declaredPermissionsByHref, gate.canAny],
	);

	const filteredLocal = query
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
	const filtered = query ? [...filteredLocal, ...dynamicResults] : filteredLocal;

	const closeSearch = useCallback(() => {
		setOpen(false);
		setQuery("");
		const returnTarget = returnFocusRef.current;
		returnFocusRef.current = null;
		setTimeout(() => returnTarget?.focus(), 0);
	}, []);

	const openSearch = useCallback(() => {
		const activeElement = document.activeElement;
		returnFocusRef.current = activeElement instanceof HTMLElement ? activeElement : null;
		setOpen(true);
	}, []);

	const navigate = useCallback(
		(item: SearchItem) => {
			setOpen(false);
			setQuery("");
			returnFocusRef.current = null;
			router.push(item.href);
		},
		[router]
	);

	useEffect(() => {
		if (externalOpenSignal > 0) {
			openSearch();
		}
	}, [externalOpenSignal, openSearch]);

	useEffect(() => {
		window.addEventListener("vcontrolhub:open-global-search", openSearch);
		return () => window.removeEventListener("vcontrolhub:open-global-search", openSearch);
	}, [openSearch]);

	useEffect(() => {
		const handleKeyDown = (e: KeyboardEvent) => {
			if ((e.metaKey || e.ctrlKey) && e.key === "k") {
				e.preventDefault();
				if (open) {
					closeSearch();
				} else {
					openSearch();
				}
			}
			if (e.key === "Escape" && open) {
				closeSearch();
			}
		};
		window.addEventListener("keydown", handleKeyDown);
		return () => window.removeEventListener("keydown", handleKeyDown);
	}, [closeSearch, open, openSearch]);

	useEffect(() => {
		if (open) {
			setTimeout(() => inputRef.current?.focus(), 50);

			setSelectedIndex(0);
		}
	}, [open]);



	useEffect(() => {
		setSelectedIndex(0);
	}, [query]);

	useEffect(() => {
		const normalized = query.trim();
		if (!open || normalized.length < 2) {
			setDynamicResults([]);
			return;
		}
		const controller = new AbortController();
		const timeout = window.setTimeout(() => {
			void fetch(`/api/search?q=${encodeURIComponent(normalized)}&limit=6`, { signal: controller.signal })
				.then((response) => (response.ok ? response.json() : { results: [] }))
				.then((data: DynamicSearchResponse) => setDynamicResults(Array.isArray(data.results) ? data.results : []))
				.catch((error) => {
					if (error instanceof Error && error.name === "AbortError") return;
					setDynamicResults([]);
				});
		}, 180);
		return () => {
			controller.abort();
			window.clearTimeout(timeout);
		};
	}, [open, query]);

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
		<div className="fixed inset-0 z-[70] flex items-start justify-center pt-[15vh] bg-black/60 backdrop-blur-sm" onClick={closeSearch}>
			<div
				role="dialog"
				aria-modal="true"
				aria-label={t("search.dialog")}
				className="w-full max-w-lg mx-4 bg-[var(--modal-bg)] border border-[var(--border)] rounded-2xl shadow-2xl overflow-hidden"
				onClick={(e) => e.stopPropagation()}
				>
				<div className="flex items-center px-4 border-b border-[var(--border)]">
					<svg className="w-4 h-4 text-[var(--text-muted)] shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
						<path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
					</svg>
					<input
						ref={inputRef}
						type="text"
						role="combobox"
						aria-label={t("search.input-label")}
						aria-expanded="true"
						aria-controls="global-search-results"
						aria-activedescendant={filtered[selectedIndex] ? `global-search-result-${selectedIndex}`: undefined} aria-autocomplete="list" value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={handleKeyDown} placeholder={t("search.placeholder")} className="flex-1 bg-transparent px-3 py-3.5 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none" /> <kbd className="text-[10px] text-[var(--text-muted)] bg-[var(--surface-hover)] rounded px-1.5 py-0.5">ESC</kbd> </div> <ul id="global-search-results" role="listbox" className="max-h-72 overflow-y-auto py-2"> {filtered.length === 0 && ( <li className="px-4 py-6 text-center text-sm text-[var(--text-muted)]">{t("search.no-results")}</li> )} {filtered.map((item, i) => ( <li key={item.href + item.label} id={`global-search-result-${i}`} role="option" aria-selected={i === selectedIndex}>
							<button
								onClick={() => navigate(item)}
								className={`w-full flex items-center gap-3 px-4 py-2.5 text-sm transition ${
									i === selectedIndex ?"bg-[var(--surface-elevated)] text-[var(--text-primary)]" :"text-[var(--text-secondary)] hover:bg-[var(--surface-elevated)]"
								}`}
							>
								<span className="text-base">{item.icon}</span>
								<span className="flex-1 text-left">{item.label}</span>
								<span className="text-[10px] text-[var(--text-muted)]">{item.category}</span>
							</button>
						</li>
					))}
				</ul>
				<div className="border-t border-[var(--border-subtle)] px-4 py-2 flex items-center gap-4 text-[10px] text-[var(--text-muted)]">
					<span>{t("search.shortcut-select")}</span>
					<span>{t("search.shortcut-confirm")}</span>
					<span>{t("search.shortcut-close")}</span>
				</div>
			</div>
		</div>
	);
}
