"use client";

import { useEffect, useState, useRef, useCallback, useMemo } from "react";
import { useRouter } from "next/navigation";
import { mainNavItems, systemNavItems } from "./nav-items";
import { useI18n } from "@/lib/i18n/use-locale";
import { t as translate, type Locale } from "@/lib/i18n/translations";
import { type Permission } from "@/lib/auth/rbac";
import { useGateRoute } from "@/lib/auth/use-gate-route";
import { useDialogFocus } from "@/lib/a11y/use-dialog-focus";

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

type SearchMetadata = { icon: string; keywordsKey?: string };

const searchItemMetadata: Record<string, SearchMetadata> = {
	"/": { icon: "📊", keywordsKey: "search.keywords.root" },
	"/servers": { icon: "🖥️", keywordsKey: "search.keywords.servers" },
	"/health": { icon: "💚", keywordsKey: "search.keywords.health" },
	"/traffic": { icon: "📈", keywordsKey: "search.keywords.traffic" },
	"/files": { icon: "📁", keywordsKey: "search.keywords.files" },
	"/downloads": { icon: "📥", keywordsKey: "search.keywords.downloads" },
	"/operation-tasks": { icon: "🧾", keywordsKey: "search.keywords.operationTasks" },
	"/shares": { icon: "🔗", keywordsKey: "search.keywords.shares" },
	"/backups": { icon: "💾", keywordsKey: "search.keywords.backups" },
	"/templates": { icon: "🧩", keywordsKey: "search.keywords.templates" },
	"/deployments": { icon: "🚀", keywordsKey: "search.keywords.deployments" },
	"/quick-services": { icon: "⚡", keywordsKey: "search.keywords.quickServices" },
	"/snippets": { icon: "💻", keywordsKey: "search.keywords.snippets" },
	"/media": { icon: "🎞️", keywordsKey: "search.keywords.media" },
	"/image-bed": { icon: "🖼️", keywordsKey: "search.keywords.imageBed" },
	"/ai": { icon: "🤖", keywordsKey: "search.keywords.ai" },
	"/announcements": { icon: "📣", keywordsKey: "search.keywords.announcements" },
	"/tickets": { icon: "🎫", keywordsKey: "search.keywords.tickets" },
	"/requests": { icon: "✅", keywordsKey: "search.keywords.requests" },
	"/scheduled-tasks": { icon: "⏰", keywordsKey: "search.keywords.scheduledTasks" },
	"/alert-rules": { icon: "🚨", keywordsKey: "search.keywords.alertRules" },
	"/notifications": { icon: "🔔", keywordsKey: "search.keywords.notifications" },
	"/settings": { icon: "⚙️", keywordsKey: "search.keywords.settings" },
	"/users": { icon: "👥", keywordsKey: "search.keywords.users" },
	"/api-tokens": { icon: "🔑", keywordsKey: "search.keywords.apiTokens" },
	"/status": { icon: "📡", keywordsKey: "search.keywords.status" },
	"/audit": { icon: "📋", keywordsKey: "search.keywords.audit" },
	"/qa-reports": { icon: "🧪", keywordsKey: "search.keywords.qaReports" },
};

type SearchItemDefinition = Omit<SearchItem, "label" | "category" | "keywords"> & {
	labelKey: string;
	fallbackLabel: string;
	categoryKey: string;
	fallbackCategory: string;
	keywordsKey?: string;
};

function categoryForHref(href: string) {
	if (href === "/status") return { key: "search.category.public", fallback: "Public page" };
	if (href === "/users" || href === "/api-tokens" || href === "/audit") return { key: "search.category.system", fallback: "System" };
	return { key: "search.category.page", fallback: "Page" };
}

const navigationSearchItems: SearchItemDefinition[] = [...mainNavItems, ...systemNavItems].map((item) => {
	const metadata = searchItemMetadata[item.href];
	const category = categoryForHref(item.href);
	return {
		labelKey: item.labelKey,
		fallbackLabel: item.fallbackLabel,
		href: item.href,
		icon: metadata?.icon ?? "🔎",
		categoryKey: category.key,
		fallbackCategory: category.fallback,
		keywordsKey: metadata?.keywordsKey,
	};
});

const searchItemDefinitions: SearchItemDefinition[] = [
	...navigationSearchItems,
	{ labelKey: "nav.ssh", fallbackLabel: "SSH Terminal", href: "/servers", icon: "🔑", categoryKey: "search.category.tool", fallbackCategory: "Tool", keywordsKey: "search.keywords.ssh" },
	{ labelKey: "auth.change-password", fallbackLabel: "Change password", href: "/settings#password", icon: "🔐", categoryKey: "search.category.action", fallbackCategory: "Action", keywordsKey: "search.keywords.changePassword" },
	{ labelKey: "auth.two-factor", fallbackLabel: "Two-factor authentication", href: "/settings#2fa", icon: "🛡️", categoryKey: "search.category.action", fallbackCategory: "Action", keywordsKey: "search.keywords.twoFactor" },
	{ labelKey: "preferencesPage.category.personal.title", fallbackLabel: "Personal preferences", href: "/settings#personal-preferences", icon: "👤", categoryKey: "search.category.action", fallbackCategory: "Action", keywordsKey: "search.keywords.personalPreferences" },
];

function getKeywords(key: string | undefined, locale: Locale): string[] {
	if (!key) return [];
	const translated = translate(key, locale);
	return translated === key ? [] : translated.split("|").filter(Boolean);
}

function localizeSearchItems(locale: Locale): SearchItem[] {
	return searchItemDefinitions.map((item) => ({
		label: translate(item.labelKey, locale) === item.labelKey ? item.fallbackLabel : translate(item.labelKey, locale),
		href: item.href,
		icon: item.icon,
		category: translate(item.categoryKey, locale) === item.categoryKey ? item.fallbackCategory : translate(item.categoryKey, locale),
		keywords: getKeywords(item.keywordsKey, locale),
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

	const dialogRef = useDialogFocus<HTMLDivElement>({ open, onClose: closeSearch, initialFocusRef: inputRef });

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
				ref={dialogRef}
				role="dialog"
				aria-modal="true"
				aria-label={t("search.dialog")}
				className="w-full max-w-lg mx-4 bg-[var(--modal-bg)] border border-[var(--border)] rounded-2xl shadow-2xl overflow-hidden"
				onClick={(e) => e.stopPropagation()}
				>
				<div className="flex items-center px-4 border-b border-[var(--border)]">
					<svg className="w-4 h-4 text-[var(--text-muted)] shrink-0" fill="none" stroke="currentColor" width="24" height="24" viewBox="0 0 24 24">
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
