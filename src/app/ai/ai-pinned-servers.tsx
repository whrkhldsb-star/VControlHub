"use client";

/**
 * Pinned servers of the open conversation, as compact chips above the composer. The assistant targets these
 * first, and Auto / Full auto run commands only on them while any are pinned. Adding needs `server:read` (the
 * page then lists the servers this account may reach); a pin whose server is not listed shows its id.
 */
import { useId, useMemo, useRef, useState } from "react";

import { Plus, Search, Server, X } from "@/components/icons";
import { Chip } from "@/components/ui-primitives";
import { useDismiss } from "@/components/ui/menu";
import { useI18n } from "@/lib/i18n/use-locale";
import { UI_INPUT } from "@/lib/ui/classes";
import { cn } from "@/lib/ui/cn";

import type { AiServerOption } from "./ai-types";
import { MAX_PINNED_SERVERS } from "./hooks/use-pinned-servers";

/** Options listed in the picker at once; the search narrows a longer inventory. */
const PICKER_LIMIT = 60;

export function AiPinnedServers({
	servers,
	pinnedIds,
	canEdit,
	saving = false,
	onChange,
}: {
	servers: AiServerOption[];
	pinnedIds: string[];
	canEdit: boolean;
	saving?: boolean;
	onChange: (ids: string[]) => void;
}) {
	const { t } = useI18n();
	const [open, setOpen] = useState(false);
	const [query, setQuery] = useState("");
	const menuRef = useRef<HTMLDivElement | null>(null);
	const listId = useId();
	useDismiss({ open, refs: [menuRef], onDismiss: () => setOpen(false) });

	const byId = useMemo(() => new Map(servers.map((server) => [server.id, server])), [servers]);
	const filtered = useMemo(() => {
		const needle = query.trim().toLowerCase();
		const matches = needle
			? servers.filter((server) => server.name.toLowerCase().includes(needle) || server.host.toLowerCase().includes(needle))
			: servers;
		return matches.slice(0, PICKER_LIMIT);
	}, [query, servers]);

	if (pinnedIds.length === 0 && (!canEdit || servers.length === 0)) return null;
	const full = pinnedIds.length >= MAX_PINNED_SERVERS;
	const nameOf = (id: string) => byId.get(id)?.name ?? t("aiPage.pins.unknownServer", { id: id.slice(0, 10) });
	const toggle = (id: string) => {
		if (pinnedIds.includes(id)) onChange(pinnedIds.filter((pinned) => pinned !== id));
		else if (!full) onChange([...pinnedIds, id]);
	};

	return (
		<div
			data-ai-pinned-servers
			aria-busy={saving || undefined}
			title={t("aiPage.pins.hint")}
			className="flex min-w-0 flex-wrap items-center gap-1.5"
		>
			<span className="inline-flex items-center gap-1 text-[11px] font-medium text-[var(--text-muted)]">
				<Server size={12} aria-hidden />
				{t("aiPage.pins.label")}
			</span>
			{pinnedIds.map((id) => {
				const name = nameOf(id);
				const server = byId.get(id);
				return (
					<span
						key={id}
						data-pinned-server={id}
						title={server ? `${server.name} · ${server.host}` : name}
						className="inline-flex max-w-[14rem] items-center gap-1 rounded-full border border-[var(--accent-border)] bg-[var(--accent-bg)] py-0.5 pl-2 pr-0.5 text-xs text-[var(--accent)]"
					>
						<span className="min-w-0 truncate">{name}</span>
						{canEdit ? (
							<button
								type="button"
								onClick={() => onChange(pinnedIds.filter((pinned) => pinned !== id))}
								aria-label={t("aiPage.pins.remove", { name })}
								title={t("aiPage.pins.remove", { name })}
								className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full hover:bg-[var(--surface-hover)]"
							>
								<X size={11} aria-hidden />
							</button>
						) : null}
					</span>
				);
			})}
			{canEdit && servers.length > 0 ? (
				<div ref={menuRef} className="relative">
					<Chip
						dashed
						icon={<Plus size={12} aria-hidden />}
						aria-expanded={open}
						aria-haspopup="listbox"
						aria-controls={open ? listId : undefined}
						disabled={full}
						title={full ? t("aiPage.pins.max", { max: MAX_PINNED_SERVERS }) : t("aiPage.pins.hint")}
						onClick={() => setOpen((value) => !value)}
					>
						{t("aiPage.pins.add")}
					</Chip>
					{open ? (
						<div data-popover className="absolute bottom-full left-0 z-30 mb-1.5 w-72 max-w-[calc(100vw-2rem)] p-2">
							<label className="relative block">
								<Search size={13} aria-hidden className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
								<input
									type="search"
									value={query}
									autoFocus
									onChange={(event) => setQuery(event.target.value)}
									aria-label={t("aiPage.pins.search")}
									placeholder={t("aiPage.pins.search")}
									className={cn(UI_INPUT, "h-8 w-full pl-8 text-xs")}
								/>
							</label>
							<div
								id={listId}
								role="listbox"
								aria-multiselectable="true"
								aria-label={t("aiPage.pins.pickerAria")}
								className="mt-1.5 max-h-56 overflow-y-auto"
							>
								{filtered.length === 0 ? (
									<p className="px-2 py-2 text-xs text-[var(--text-muted)]">{t("aiPage.pins.empty")}</p>
								) : (
									filtered.map((server) => {
										const pinned = pinnedIds.includes(server.id);
										return (
											<button
												key={server.id}
												type="button"
												role="option"
												aria-selected={pinned}
												disabled={!pinned && full}
												onClick={() => toggle(server.id)}
												data-menu-item
												className={cn("w-full", pinned && "font-medium !text-[var(--accent)]")}
											>
												<span className="min-w-0 flex-1 truncate text-left">{server.name}</span>
												<span className="shrink-0 font-mono text-[10px] text-[var(--text-muted)]">{server.host}</span>
											</button>
										);
									})
								)}
							</div>
						</div>
					) : null}
				</div>
			) : null}
		</div>
	);
}
