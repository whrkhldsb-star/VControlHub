"use client";

import { useEffect, useState, useRef, useCallback, useMemo } from "react";
import { useRouter } from "next/navigation";
import { mainNavItems, systemNavItems } from "./nav-items";
import { useI18n } from "@/lib/i18n/use-locale";
import { browserT as translate, type Locale } from "@/lib/i18n/browser-translations";
import { type Permission } from "@/lib/auth/rbac";
import { filterByHrefPermissions } from "@/lib/auth/filter-by-href-permissions";
import { useGateRoute } from "@/lib/auth/use-gate-route";
import { ModalShell } from "@/components/modal-shell";
import { api } from "@/lib/http/api-client";
import { getErrorMessage } from "@/lib/http/error-message";
import { Search, X } from "./icons";
import { IconButton } from "./ui-primitives";

const navigationIcons = new Map([...mainNavItems, ...systemNavItems].map((item) => [item.href, item.icon]));
function searchIcon(href: string) {
	const pathname = href.split(/[?#]/)[0] ?? "/";
	return navigationIcons.get(pathname) ?? navigationIcons.get(`/${pathname.split("/")[1]}`) ?? <Search size={18} />;
}

export interface SearchItem {
	label: string;
	href: string;
	category: string;
	keywords?: string[];
}

type DynamicSearchResponse = {
	results?: SearchItem[];
};

type SearchMetadata = { keywordsKey?: string };

const searchItemMetadata: Record<string, SearchMetadata> = {
	"/": { keywordsKey: "search.keywords.root" },
	"/servers": { keywordsKey: "search.keywords.servers" },
	"/health": { keywordsKey: "search.keywords.health" },
	"/vps-status": { keywordsKey: "search.keywords.vpsStatus" },
	"/traffic": { keywordsKey: "search.keywords.traffic" },
	"/files": { keywordsKey: "search.keywords.files" },
	"/downloads": { keywordsKey: "search.keywords.downloads" },
	"/operation-tasks": { keywordsKey: "search.keywords.operationTasks" },
	"/shares": { keywordsKey: "search.keywords.shares" },
	"/backups": { keywordsKey: "search.keywords.backups" },
	"/templates": { keywordsKey: "search.keywords.templates" },
	"/deployments": { keywordsKey: "search.keywords.deployments" },
	"/quick-services": { keywordsKey: "search.keywords.quickServices" },
	"/snippets": { keywordsKey: "search.keywords.snippets" },
	"/media": { keywordsKey: "search.keywords.media" },
	"/image-bed": { keywordsKey: "search.keywords.imageBed" },
	"/ai": { keywordsKey: "search.keywords.ai" },
	"/knowledge": { keywordsKey: "search.keywords.knowledge" },
	"/announcements": { keywordsKey: "search.keywords.announcements" },
	"/tickets": { keywordsKey: "search.keywords.tickets" },
	"/requests": { keywordsKey: "search.keywords.requests" },
	"/scheduled-tasks": { keywordsKey: "search.keywords.scheduledTasks" },
	"/alert-rules": { keywordsKey: "search.keywords.alertRules" },
	"/notifications": { keywordsKey: "search.keywords.notifications" },
	"/settings": { keywordsKey: "search.keywords.settings" },
	"/users": { keywordsKey: "search.keywords.users" },
	"/api-tokens": { keywordsKey: "search.keywords.apiTokens" },
	"/status": { keywordsKey: "search.keywords.status" },
	"/audit": { keywordsKey: "search.keywords.audit" },
};

type SearchItemDefinition = Omit<SearchItem, "label" | "category" | "keywords"> & {
	labelKey: string;
	fallbackLabel: string;
	categoryKey: string;
	fallbackCategory: string;
	keywordsKey?: string;
	/** Extra capability for an action that shares a route with a broader page. */
	requiredPermission?: Permission;
};

type LocalSearchItem = SearchItem & {
	requiredPermission?: Permission;
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
		categoryKey: category.key,
		fallbackCategory: category.fallback,
		keywordsKey: metadata?.keywordsKey,
	};
});

const searchItemDefinitions: SearchItemDefinition[] = [
	...navigationSearchItems,
	{ labelKey: "nav.ssh", fallbackLabel: "SSH Terminal", href: "/servers", categoryKey: "search.category.tool", fallbackCategory: "Tool", keywordsKey: "search.keywords.ssh", requiredPermission: "server:ssh" },
	{ labelKey: "auth.change-password", fallbackLabel: "Change password", href: "/account/password", categoryKey: "search.category.action", fallbackCategory: "Action", keywordsKey: "search.keywords.changePassword" },
	{ labelKey: "auth.two-factor", fallbackLabel: "Two-factor authentication", href: "/account/security", categoryKey: "search.category.action", fallbackCategory: "Action", keywordsKey: "search.keywords.twoFactor" },
	{ labelKey: "preferencesPage.category.personal.title", fallbackLabel: "Personal preferences", href: "/settings#personal-preferences", categoryKey: "search.category.action", fallbackCategory: "Action", keywordsKey: "search.keywords.personalPreferences" },
];

function getKeywords(key: string | undefined, locale: Locale): string[] {
	if (!key) return [];
	const translated = translate(key, locale);
	return translated === key ? [] : translated.split("|").filter(Boolean);
}

function localizeSearchItems(locale: Locale): LocalSearchItem[] {
	return searchItemDefinitions.map((item) => ({
		label: translate(item.labelKey, locale) === item.labelKey ? item.fallbackLabel : translate(item.labelKey, locale),
		href: item.href,
		category: translate(item.categoryKey, locale) === item.categoryKey ? item.fallbackCategory : translate(item.categoryKey, locale),
		keywords: getKeywords(item.keywordsKey, locale),
		requiredPermission: item.requiredPermission,
	}));
}

export function getSearchItems(locale: Locale = "zh"): SearchItem[] {
	return localizeSearchItems(locale);
}

/** Search alias — shared contract lives in filter-by-href-permissions. */
const filterItemsByPermissions = filterByHrefPermissions;

export function GlobalSearch({
	externalOpenSignal = 0,
	declaredPermissionsByHref = {},
}: {
	externalOpenSignal?: number;
	declaredPermissionsByHref?: Record<string, readonly Permission[]>;
}) {
	const [open, setOpen] = useState(false);
	const [query, setQuery] = useState("");
	const [dynamicResults, setDynamicResults] = useState<{ query: string; items: SearchItem[] }>({ query: "", items: [] });
	const [searchError, setSearchError] = useState<string | null>(null);
	const [selectedIndex, setSelectedIndex] = useState(0);
	const inputRef = useRef<HTMLInputElement>(null);
	const returnFocusRef = useRef<HTMLElement | null>(null);
	const router = useRouter();
	const { locale, t } = useI18n();
	const { can, canAny } = useGateRoute();
	const searchItems = useMemo(() => {
		const routeVisible = filterItemsByPermissions(
			localizeSearchItems(locale),
			declaredPermissionsByHref,
			canAny,
		);
		return routeVisible.filter(
			(item) => !item.requiredPermission || can(item.requiredPermission),
		);
	}, [locale, declaredPermissionsByHref, can, canAny]);

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
	const filtered = query ? [...filteredLocal, ...(dynamicResults.query === query.trim() ? dynamicResults.items : [])] : filteredLocal;

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
			setSelectedIndex(0);
		}
	}, [open]);

	useEffect(() => {
		if (open) document.getElementById(`global-search-result-${selectedIndex}`)?.scrollIntoView?.({ block: "nearest" });
	}, [open, selectedIndex]);



	useEffect(() => {
		setSelectedIndex(0);
	}, [query]);

	useEffect(() => {
		const normalized = query.trim();
		setSearchError(null);
		if (!open || normalized.length < 2) {
			setDynamicResults({ query: "", items: [] });
			return;
		}
		const controller = new AbortController();
		const timeout = window.setTimeout(() => {
			void api.get<DynamicSearchResponse>(`/api/search?q=${encodeURIComponent(normalized)}&limit=6`, { signal: controller.signal })
				.then((data) => {
					if (!controller.signal.aborted) setDynamicResults({ query: normalized, items: Array.isArray(data.results) ? data.results : [] });
				})
				.catch((error) => {
					if (controller.signal.aborted || (error instanceof Error && error.name === "AbortError")) return;
					setDynamicResults({ query: normalized, items: [] });
					setSearchError(getErrorMessage(error, t("common.status.failed")));
				});
		}, 180);
		return () => {
			controller.abort();
			window.clearTimeout(timeout);
		};
	}, [open, query, t]);

	const handleKeyDown = (e: React.KeyboardEvent) => {
		if (e.key === "ArrowDown") {
			e.preventDefault();
			// When filtered is empty, length-1 is -1; keep selection at 0 so aria-activedescendant stays valid.
			setSelectedIndex((i) =>
				filtered.length === 0 ? 0 : Math.min(i + 1, filtered.length - 1),
			);
		} else if (e.key === "ArrowUp") {
			e.preventDefault();
			setSelectedIndex((i) => Math.max(i - 1, 0));
		} else if (e.key === "Enter" && filtered[selectedIndex]) {
			navigate(filtered[selectedIndex]);
		}
	};

	return (
		<ModalShell
			open={open}
			onClose={closeSearch}
			label={t("search.dialog")}
			overlayClassName="fixed inset-0 z-[70] flex items-start justify-center bg-[var(--overlay)] p-4 pt-[min(12dvh,4rem)]"
			panelClassName="flex max-h-[calc(88dvh-1rem)] w-full max-w-lg flex-col overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--modal-bg)] shadow-[var(--shadow-lg)]"
			initialFocusRef={inputRef}
		>
				<div className="flex shrink-0 items-center gap-2 border-b border-[var(--border)] px-4">
					<Search size={16} aria-hidden className="shrink-0 text-[var(--text-muted)]" />
					<input
						ref={inputRef}
						type="text"
						role="combobox"
						aria-label={t("search.input-label")}
						aria-expanded={filtered.length > 0}
						aria-controls="global-search-results"
						aria-activedescendant={
							filtered[selectedIndex] ? `global-search-result-${selectedIndex}` : undefined
						}
						aria-autocomplete="list"
						value={query}
						onChange={(e) => setQuery(e.target.value)}
						onKeyDown={handleKeyDown}
						placeholder={t("search.placeholder")}
						className="min-w-0 flex-1 bg-transparent py-3.5 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none"
					/>
					<IconButton label={t("common.close")} onClick={closeSearch}><X size={16} aria-hidden /></IconButton>
				</div>
				{searchError && <p role="alert" className="shrink-0 break-words px-4 py-2 text-sm text-[var(--danger)]">{searchError}</p>}
				{filtered.length === 0 && (
					<p role="status" className="px-4 py-8 text-center text-sm text-[var(--text-muted)]">{t("search.no-results")}</p>
				)}
				<ul id="global-search-results" role="listbox" hidden={filtered.length === 0} className="min-h-0 max-h-72 overflow-y-auto py-1.5">
					{filtered.map((item, i) => (
						<li
							key={item.href + item.label}
							role="presentation"
						>
							<button
								type="button"
								id={`global-search-result-${i}`}
								role="option"
								aria-selected={i === selectedIndex}
								tabIndex={-1}
								onMouseDown={(event) => event.preventDefault()}
								onClick={() => navigate(item)}
								className={`flex w-full items-center gap-3 px-4 py-2.5 text-sm transition ${
									i === selectedIndex
										? "bg-[var(--accent-bg)] text-[var(--text-primary)]"
										: "text-[var(--text-secondary)] hover:bg-[var(--surface-hover)]"
								}`}
							>
								<span
									className="flex h-8 w-8 shrink-0 items-center justify-center text-[var(--text-muted)]"
									aria-hidden="true"
								>
									{searchIcon(item.href)}
								</span>
								<span className="min-w-0 flex-1 truncate text-left font-medium">{item.label}</span>
								<span className="max-w-[30%] shrink-0 truncate text-xs text-[var(--text-muted)]">
									{item.category}
								</span>
							</button>
						</li>
					))}
				</ul>
		</ModalShell>
	);
}
