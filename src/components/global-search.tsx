"use client";

import { useEffect, useState, useRef, useCallback, useMemo, type ReactNode } from "react";
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
import { isImeComposition } from "@/lib/ui/keyboard";
import { useOptionalTheme } from "@/lib/theme/use-theme";
import { toggleSidebarCollapsed, useRecentPages } from "@/lib/ui/shell-preferences";
import { cn } from "@/lib/ui/cn";
import { X } from "./icons";
import { IconHistory, IconKeyboard, IconLanguages, IconMoon, IconPanelLeft, IconSearch, IconSun } from "./nav-icons";
import { IconButton } from "./ui-primitives";
import { OPEN_SHORTCUTS_EVENT } from "./user-menu";

const navigationIcons = new Map([...mainNavItems, ...systemNavItems].map((item) => [item.href, item.icon]));
function searchIcon(href: string) {
	const pathname = href.split(/[?#]/)[0] ?? "/";
	return navigationIcons.get(pathname) ?? navigationIcons.get(`/${pathname.split("/")[1]}`) ?? <IconSearch size={17} />;
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
	"/docker": { keywordsKey: "search.keywords.docker" },
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

type PaletteEntry =
	| { kind: "link"; key: string; label: string; detail: string; icon: ReactNode; item: SearchItem }
	| { kind: "action"; key: string; label: string; detail: string; icon: ReactNode; run: () => void; keywords: string[] };

type PaletteSection = { id: string; title: string; entries: PaletteEntry[] };

function matches(query: string, ...values: Array<string | undefined>) {
	return values.some((value) => value?.toLowerCase().includes(query));
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
	const [dynamicResults, setDynamicResults] = useState<{ query: string; items: SearchItem[] }>({ query: "", items: [] });
	const [searchError, setSearchError] = useState<string | null>(null);
	const [selectedIndex, setSelectedIndex] = useState(0);
	const inputRef = useRef<HTMLInputElement>(null);
	const returnFocusRef = useRef<HTMLElement | null>(null);
	const router = useRouter();
	const { locale, t, setLocale } = useI18n();
	const { theme, toggleTheme } = useOptionalTheme();
	const recentHrefs = useRecentPages();
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
		[router],
	);

	const sections = useMemo<PaletteSection[]>(() => {
		const normalized = query.trim().toLowerCase();
		const toLink = (item: SearchItem, prefix: string): PaletteEntry => ({
			kind: "link",
			key: `${prefix}:${item.href}:${item.label}`,
			label: item.label,
			detail: item.category,
			icon: searchIcon(item.href),
			item,
		});
		const actionCategory = t("search.category.action") === "search.category.action" ? "Action" : t("search.category.action");
		const actions: PaletteEntry[] = [
			{ kind: "action", key: "action:theme", label: t("shell.action.toggleTheme"), detail: actionCategory, icon: theme === "dark" ? <IconSun size={17} /> : <IconMoon size={17} />, run: toggleTheme, keywords: ["theme", "dark", "light", "主题", "深色", "浅色"] },
			{ kind: "action", key: "action:language", label: t("shell.action.toggleLanguage"), detail: actionCategory, icon: <IconLanguages size={17} />, run: () => setLocale(locale === "zh" ? "en" : "zh"), keywords: ["language", "english", "中文", "语言"] },
			{ kind: "action", key: "action:sidebar", label: t("shell.action.toggleSidebar"), detail: actionCategory, icon: <IconPanelLeft size={17} />, run: toggleSidebarCollapsed, keywords: ["sidebar", "侧边栏", "导航"] },
			{ kind: "action", key: "action:shortcuts", label: t("shell.action.shortcuts"), detail: actionCategory, icon: <IconKeyboard size={17} />, run: () => window.dispatchEvent(new Event(OPEN_SHORTCUTS_EVENT)), keywords: ["keyboard", "shortcut", "快捷键", "键盘"] },
		];
		if (!normalized) {
			const recent = recentHrefs
				.map((href) => searchItems.find((item) => item.href === href))
				.filter((item): item is LocalSearchItem => Boolean(item))
				.map((item) => ({ ...toLink(item, "recent"), icon: <IconHistory size={17} /> }));
			return [
				{ id: "recent", title: t("shell.palette.recent"), entries: recent },
				{ id: "actions", title: t("shell.palette.actions"), entries: actions },
				{ id: "pages", title: t("shell.palette.pages"), entries: searchItems.map((item) => toLink(item, "page")) },
			].filter((section) => section.entries.length > 0);
		}
		const pages = searchItems
			.filter((item) => matches(normalized, item.label, item.category, ...(item.keywords ?? [])))
			.map((item) => toLink(item, "page"));
		const matchedActions = actions.filter((entry) => entry.kind === "action" && matches(normalized, entry.label, ...entry.keywords));
		const remote = dynamicResults.query === query.trim() ? dynamicResults.items.map((item) => toLink(item, "remote")) : [];
		return [
			{ id: "pages", title: t("shell.palette.pages"), entries: pages },
			{ id: "actions", title: t("shell.palette.actions"), entries: matchedActions },
			{ id: "resources", title: t("shell.palette.resources"), entries: remote },
		].filter((section) => section.entries.length > 0);
	}, [query, searchItems, recentHrefs, dynamicResults, t, theme, toggleTheme, setLocale, locale]);

	const flat = useMemo(() => sections.flatMap((section) => section.entries), [sections]);

	const activate = useCallback((entry: PaletteEntry | undefined) => {
		if (!entry) return;
		if (entry.kind === "link") {
			navigate(entry.item);
			return;
		}
		closeSearch();
		entry.run();
	}, [navigate, closeSearch]);

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
		if (isImeComposition(e)) return;
		if (e.key === "ArrowDown") {
			e.preventDefault();
			// When the list is empty, length-1 is -1; keep selection at 0 so aria-activedescendant stays valid.
			setSelectedIndex((i) => (flat.length === 0 ? 0 : Math.min(i + 1, flat.length - 1)));
		} else if (e.key === "ArrowUp") {
			e.preventDefault();
			setSelectedIndex((i) => Math.max(i - 1, 0));
		} else if (e.key === "Enter" && flat[selectedIndex]) {
			e.preventDefault();
			activate(flat[selectedIndex]);
		}
	};

	let optionIndex = -1;

	return (
		<ModalShell
			open={open}
			onClose={closeSearch}
			label={t("search.dialog")}
			overlayClassName="fixed inset-0 z-[var(--z-popover)] flex items-start justify-center bg-[var(--overlay)] p-3 pt-[min(14dvh,6rem)] backdrop-blur-[2px]"
			panelClassName="flex max-h-[min(36rem,calc(86dvh-1rem))] w-full max-w-[40rem] flex-col overflow-hidden border border-[var(--border)] bg-[var(--modal-bg)] shadow-[var(--shadow-lg)]"
			initialFocusRef={inputRef}
		>
			<div className="flex shrink-0 items-center gap-2.5 border-b border-[var(--border-subtle)] px-4">
				<IconSearch size={17} className="shrink-0 text-[var(--text-muted)]" />
				<input
					ref={inputRef}
					type="text"
					role="combobox"
					aria-label={t("search.input-label")}
					aria-expanded={flat.length > 0}
					aria-controls="global-search-results"
					aria-activedescendant={flat[selectedIndex] ? `global-search-result-${selectedIndex}` : undefined}
					aria-autocomplete="list"
					value={query}
					onChange={(e) => setQuery(e.target.value)}
					onKeyDown={handleKeyDown}
					placeholder={t("search.placeholder")}
					className="min-w-0 flex-1 bg-transparent py-3.5 text-[15px] text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none"
				/>
				<IconButton label={t("common.close")} onClick={closeSearch} className="h-8 w-8"><X size={16} aria-hidden /></IconButton>
			</div>
			{searchError && <p role="alert" className="shrink-0 break-words px-4 py-2 text-sm text-[var(--danger)]">{searchError}</p>}
			{flat.length === 0 && (
				<p role="status" className="px-4 py-10 text-center text-sm text-[var(--text-muted)]">{t("search.no-results")}</p>
			)}
			<ul id="global-search-results" role="listbox" hidden={flat.length === 0} className="min-h-0 flex-1 overflow-y-auto p-1.5">
				{sections.map((section) => (
					<li key={section.id} role="presentation" className="pb-1">
						<div aria-hidden="true" className="px-2.5 pb-1 pt-2 text-[11px] font-medium text-[var(--text-muted)]">
							{section.title}
						</div>
						<ul role="presentation">
							{section.entries.map((entry) => {
								optionIndex += 1;
								const index = optionIndex;
								const selected = index === selectedIndex;
								return (
									<li key={entry.key} role="presentation">
										<button
											type="button"
											id={`global-search-result-${index}`}
											role="option"
											aria-selected={selected}
											tabIndex={-1}
											onMouseDown={(event) => event.preventDefault()}
											onMouseMove={() => { if (!selected) setSelectedIndex(index); }}
											onClick={() => activate(entry)}
											className={cn(
												"flex w-full items-center gap-3 rounded-md px-2.5 py-2 text-left text-sm transition-colors",
												selected ? "bg-[var(--accent-soft)] text-[var(--text-primary)]" : "text-[var(--text-secondary)]",
											)}
										>
											<span
												className={cn(
													"flex h-7 w-7 shrink-0 items-center justify-center rounded-md border [&>svg]:h-4 [&>svg]:w-4",
													selected ? "border-[var(--accent-border)] bg-[var(--accent-bg)] text-[var(--accent)]" : "border-[var(--border-subtle)] bg-[var(--surface-subtle)] text-[var(--text-muted)]",
												)}
												aria-hidden="true"
											>
												{entry.icon}
											</span>
											<span className="min-w-0 flex-1 truncate font-medium">{entry.label}</span>
											<span className="max-w-[35%] shrink-0 truncate text-xs text-[var(--text-muted)]">{entry.detail}</span>
										</button>
									</li>
								);
							})}
						</ul>
					</li>
				))}
			</ul>
			<div aria-hidden="true" className="flex shrink-0 items-center gap-4 border-t border-[var(--border-subtle)] bg-[var(--surface-subtle)] px-4 py-2 text-[11px] text-[var(--text-muted)]">
				<span className="flex items-center gap-1"><span className="ui-kbd">↑</span><span className="ui-kbd">↓</span>{t("shell.palette.navigate")}</span>
				<span className="flex items-center gap-1"><span className="ui-kbd">↵</span>{t("shell.palette.open")}</span>
				<span className="flex items-center gap-1"><span className="ui-kbd">Esc</span>{t("shell.palette.dismiss")}</span>
			</div>
		</ModalShell>
	);
}
