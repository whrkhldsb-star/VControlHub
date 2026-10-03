"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { useI18n } from "@/lib/i18n/use-locale";
import { toggleSidebarCollapsed } from "@/lib/ui/shell-preferences";
import { Dialog } from "./ui/dialog";
import { mainNavItems, systemNavItems } from "./nav-items";
import { OPEN_SHORTCUTS_EVENT } from "./user-menu";

/** `G` then a letter jumps to a page. */
export const GO_TO_SHORTCUTS: Array<{ key: string; href: string }> = [
	{ key: "d", href: "/dashboard" },
	{ key: "s", href: "/servers" },
	{ key: "f", href: "/files" },
	{ key: "t", href: "/operation-tasks" },
	{ key: "m", href: "/monitoring" },
	{ key: "a", href: "/alert-rules" },
	{ key: "r", href: "/requests" },
	{ key: "n", href: "/notifications" },
	{ key: "i", href: "/ai" },
	{ key: ",", href: "/settings" },
];

/** Typing in a field, an editor or the terminal never triggers shortcuts. */
export function isEditableTarget(target: EventTarget | null) {
	if (!(target instanceof HTMLElement)) return false;
	if (target.isContentEditable) return true;
	if (target.closest("[data-shortcuts-ignore], .xterm, .cm-editor, .monaco-editor")) return true;
	const tag = target.tagName;
	return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
}

function Keys({ keys }: { keys: string[] }) {
	return (
		<span className="flex shrink-0 items-center gap-1">
			{keys.map((key) => (
				<kbd key={key} className="ui-kbd">{key}</kbd>
			))}
		</span>
	);
}

export function KeyboardShortcuts() {
	const router = useRouter();
	const { t } = useI18n();
	const [helpOpen, setHelpOpen] = useState(false);
	const pendingGo = useRef<number | null>(null);

	useEffect(() => {
		const openHelp = () => setHelpOpen(true);
		window.addEventListener(OPEN_SHORTCUTS_EVENT, openHelp);
		return () => window.removeEventListener(OPEN_SHORTCUTS_EVENT, openHelp);
	}, []);

	useEffect(() => {
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.defaultPrevented || event.isComposing || event.metaKey || event.ctrlKey || event.altKey) return;
			if (isEditableTarget(event.target)) return;
			if (document.querySelector("[data-modal-panel]")) return;
			const key = event.key.toLowerCase();
			if (pendingGo.current !== null) {
				window.clearTimeout(pendingGo.current);
				pendingGo.current = null;
				const target = GO_TO_SHORTCUTS.find((entry) => entry.key === key);
				if (target) {
					event.preventDefault();
					router.push(target.href);
				}
				return;
			}
			if (key === "g") {
				pendingGo.current = window.setTimeout(() => { pendingGo.current = null; }, 1200);
				return;
			}
			if (event.key === "?") {
				event.preventDefault();
				setHelpOpen(true);
			} else if (event.key === "/") {
				event.preventDefault();
				window.dispatchEvent(new Event("vcontrolhub:open-global-search"));
			} else if (event.key === "[") {
				event.preventDefault();
				toggleSidebarCollapsed();
			}
		};
		window.addEventListener("keydown", onKeyDown);
		return () => {
			window.removeEventListener("keydown", onKeyDown);
			if (pendingGo.current !== null) window.clearTimeout(pendingGo.current);
		};
	}, [router]);

	const pageLabels = useMemo(() => {
		const items = [...mainNavItems, ...systemNavItems];
		return Object.fromEntries(items.map((item) => {
			const label = t(item.labelKey);
			return [item.href, label === item.labelKey ? item.fallbackLabel : label];
		}));
	}, [t]);

	const general: Array<{ keys: string[]; label: string }> = [
		{ keys: ["⌘", "K"], label: t("shell.shortcuts.palette") },
		{ keys: ["/"], label: t("shell.shortcuts.search") },
		{ keys: ["["], label: t("shell.shortcuts.sidebar") },
		{ keys: ["?"], label: t("shell.shortcuts.help") },
		{ keys: ["Esc"], label: t("shell.shortcuts.close") },
	];

	return (
		<Dialog
			open={helpOpen}
			onClose={() => setHelpOpen(false)}
			title={t("shell.shortcuts.title")}
			description={t("shell.shortcuts.description")}
			size="lg"
		>
			<div className="grid gap-6 pt-1 sm:grid-cols-2">
				<section>
					<h3 className="ui-title-caption mb-2">{t("shell.shortcuts.general")}</h3>
					<ul className="space-y-2">
						{general.map((entry) => (
							<li key={entry.label} className="flex items-center justify-between gap-3 text-[13px] text-[var(--text-secondary)]">
								<span>{entry.label}</span>
								<Keys keys={entry.keys} />
							</li>
						))}
					</ul>
				</section>
				<section>
					<h3 className="ui-title-caption mb-2">{t("shell.shortcuts.navigation")}</h3>
					<ul className="space-y-2">
						{GO_TO_SHORTCUTS.map((entry) => (
							<li key={entry.href} className="flex items-center justify-between gap-3 text-[13px] text-[var(--text-secondary)]">
								<span className="truncate">{pageLabels[entry.href] ?? entry.href}</span>
								<Keys keys={["G", entry.key === "," ? "," : entry.key.toUpperCase()]} />
							</li>
						))}
					</ul>
				</section>
			</div>
		</Dialog>
	);
}
