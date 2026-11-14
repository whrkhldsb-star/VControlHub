"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { ActionButton } from "@/components/action-button";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { csrfFetch } from "@/lib/auth/csrf-client";
import type { ItsmConnectionRecord, ItsmEventRecord } from "@/lib/itsm/types";
import { useI18n } from "@/lib/i18n/use-locale";
import { useBrowserOrigin } from "@/lib/hooks/use-browser-origin";
import { formatDateTime } from "@/lib/datetime/format";
import { useToast } from "@/components/toast-provider";
import { getErrorMessage } from "@/lib/http/error-message";
import { EmptyState, ListPanel, ListRow, PageHeader, SurfacePanel } from "@/components/page-shell";
import { StatusBadge } from "@/components/status-badge";
import { Activity, LinkIcon, Plus } from "@/components/icons";

import { ItsmConnectionForm } from "./itsm-connection-form";

function eventLabel(t: (key: string) => string, prefix: string, value: string): string {
	const key = `${prefix}.${value}`;
	const translated = t(key);
	return translated === key ? value : translated;
}

type Props = {
	/** Page header; rendered here so the create command sits in its actions. */
	header: { eyebrow?: string; title: string; description?: string };
	initialConnections: ItsmConnectionRecord[];
	initialEvents: ItsmEventRecord[];
	canManage: boolean;
	publicBaseUrl: string;
};

export function ItsmPageClient({
	header,
	initialConnections,
	initialEvents,
	canManage,
	publicBaseUrl,
}: Props) {
	// Without a configured address the browser's own origin is shown; it is read after hydration, not during render.
	const browserOrigin = useBrowserOrigin();
	const baseUrlForInbound = publicBaseUrl || browserOrigin;
	const { t, locale } = useI18n();
	const { addToast } = useToast();
	const [connections, setConnections] = useState(initialConnections);
	const [events, setEvents] = useState(initialEvents);
	const [busy, setBusy] = useState(false);
	const [testingId, setTestingId] = useState<string | null>(null);
	const [pendingDelete, setPendingDelete] = useState<ItsmConnectionRecord | null>(null);
	// The form opens from the header (or the empty list) right under it; the connections come first otherwise.
	const [creating, setCreating] = useState(false);
	const panelRef = useRef<HTMLDivElement>(null);
	const closeForm = useCallback(() => setCreating(false), []);
	const openForm = canManage && !creating ? () => setCreating(true) : undefined;

	useEffect(() => {
		if (creating) panelRef.current?.scrollIntoView?.({ behavior: "smooth", block: "start" });
	}, [creating]);

	const reload = useCallback(async () => {
		try {
			const [connData, eventData] = await Promise.all([
				csrfFetch("/api/itsm/connections") as Promise<{ connections?: ItsmConnectionRecord[] }>,
				csrfFetch("/api/itsm/events?limit=30") as Promise<{ events?: ItsmEventRecord[] }>,
			]);
			if (Array.isArray(connData.connections)) setConnections(connData.connections);
			if (Array.isArray(eventData.events)) setEvents(eventData.events);
		} catch (error) {
			addToast("error", getErrorMessage(error, t("itsmPage.toast.error")));
		}
	}, [addToast, t]);

	const remove = async (row: ItsmConnectionRecord) => {
		setBusy(true);
		try {
			await csrfFetch(`/api/itsm/connections/${row.id}`, { method: "DELETE" });
			setPendingDelete(null);
			await reload();
			addToast("success", t("itsmPage.toast.deleted"));
		} catch (error) {
			addToast("error", getErrorMessage(error, t("itsmPage.toast.error")));
		} finally {
			setBusy(false);
		}
	};

	const test = async (id: string) => {
		setTestingId(id);
		try {
			const result = (await csrfFetch(`/api/itsm/connections/${id}/test`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ message: "UI connectivity test" }),
			})) as { ok?: boolean; error?: string };
			await reload();
			if (result.ok) addToast("success", t("itsmPage.toast.testOk"));
			else addToast("error", result.error || t("itsmPage.toast.testFail"));
		} catch (error) {
			addToast("error", getErrorMessage(error, t("itsmPage.toast.testFail")));
		} finally {
			setTestingId(null);
		}
	};

	const toggleEnabled = async (row: ItsmConnectionRecord) => {
		setBusy(true);
		try {
			await csrfFetch(`/api/itsm/connections/${row.id}`, {
				method: "PATCH",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ enabled: !row.enabled }),
			});
			await reload();
		} catch (error) {
			addToast("error", getErrorMessage(error, t("itsmPage.toast.error")));
		} finally {
			setBusy(false);
		}
	};

	return (
		<div className="space-y-6">
			<PageHeader eyebrow={header.eyebrow} title={header.title} description={header.description} className="">
				{openForm ? (
					<ActionButton icon={<Plus size={16} aria-hidden />} onClick={openForm}>
						{t("itsmPage.form.title")}
					</ActionButton>
				) : null}
			</PageHeader>

			{creating ? (
				<div ref={panelRef} className="scroll-mt-24">
					<SurfacePanel title={t("itsmPage.form.title")} description={t("itsmPage.form.desc")}>
						<ItsmConnectionForm onCreated={reload} onClose={closeForm} />
					</SurfacePanel>
				</div>
			) : null}

			<ListPanel
				title={t("itsmPage.list.title")}
				count={connections.length}
				actions={
					<ActionButton size="sm" variant="ghost" onClick={() => void reload()}>
						{t("itsmPage.list.refresh")}
					</ActionButton>
				}
				empty={connections.length === 0 ? (
					<EmptyState
						icon={<LinkIcon size={20} />}
						title={t("itsmPage.list.empty")}
						action={openForm ? (
							<ActionButton size="sm" variant="primary" icon={<Plus size={14} aria-hidden />} onClick={openForm}>
								{t("itsmPage.form.title")}
							</ActionButton>
						) : undefined}
					/>
				) : undefined}
			>
				{connections.map((row) => (
					<ListRow key={row.id} className="space-y-2">
						<div className="flex flex-wrap items-start justify-between gap-3">
							<div className="min-w-0 space-y-1">
								<div className="flex flex-wrap items-center gap-2">
									<span className="font-medium text-[var(--text-primary)]">{row.name}</span>
									<StatusBadge tone={row.enabled ? "success" : "neutral"} size="sm">
										{row.enabled ? t("itsmPage.status.enabled") : t("itsmPage.status.disabled")}
									</StatusBadge>
								</div>
								<p className="text-xs text-[var(--text-muted)]">
									{t(`itsmPage.provider.${row.provider}`)} · {t(`itsmPage.direction.${row.direction}`)}
								</p>
								{/* The last delivery's failure, in its own line: it is what needs attention. */}
								{row.lastError ? <p className="break-words text-xs text-[var(--danger)]">{row.lastError}</p> : null}
							</div>
							{canManage && (
								<div className="flex flex-wrap gap-2">
									<ActionButton size="sm" variant="secondary"
										disabled={busy}
										onClick={() => void toggleEnabled(row)}>
										{row.enabled ? t("itsmPage.action.disable") : t("itsmPage.action.enable")}
									</ActionButton>
									<ActionButton size="sm" variant="secondary"
										disabled={testingId === row.id}
										onClick={() => void test(row.id)}>
										{testingId === row.id
											? t("itsmPage.action.testing")
											: t("itsmPage.action.test")}
									</ActionButton>
									<ActionButton size="sm" variant="danger"
										disabled={busy}
										onClick={() => setPendingDelete(row)}>
										{t("itsmPage.action.delete")}
									</ActionButton>
								</div>
							)}
						</div>
						{(row.direction === "inbound" || row.direction === "bidirectional") && (
							<div data-inset className="break-all p-2 font-mono text-xs">
								{t("itsmPage.inboundUrl")}{t("common.colon")}{baseUrlForInbound}/api/itsm/inbound/{row.id}
							</div>
						)}
						{row.config.webhookUrl && (
							<div className="break-all text-xs text-[var(--text-muted)]">
								{t("itsmPage.field.webhookUrl")}{t("common.colon")}{row.config.webhookUrl}
							</div>
						)}
					</ListRow>
				))}
			</ListPanel>

			<ListPanel
				title={t("itsmPage.events.title")}
				empty={events.length === 0 ? <EmptyState icon={<Activity size={20} />} title={t("itsmPage.events.empty")} /> : undefined}
				bodyClassName={events.length === 0 ? undefined : "max-h-96 overflow-auto"}
			>
				{events.map((ev) => (
					<ListRow key={ev.id} className="text-sm">
						<div className="flex flex-wrap justify-between gap-2">
							<span>
								{t(`itsmPage.direction.${ev.direction}`)} · {eventLabel(t, "itsmPage.eventType", ev.eventType)} · {eventLabel(t, "itsmPage.eventStatus", ev.status)}
							</span>
							<span className="text-xs text-[var(--text-muted)]">
								{formatDateTime(ev.createdAt, locale)}
							</span>
						</div>
						{ev.ticketId && (
							<div className="text-xs text-[var(--text-muted)]">{t("itsmPage.events.ticket")}{t("common.colon")}{ev.ticketId}</div>
						)}
						{ev.errorMessage && (
							<div className="text-xs text-[var(--danger)]">{ev.errorMessage}</div>
						)}
					</ListRow>
				))}
			</ListPanel>

			<ConfirmDialog
				open={pendingDelete !== null}
				title={t("common.confirmDelete")}
				description={
					pendingDelete
						? t("itsmPage.confirm.delete", { name: pendingDelete.name })
						: ""
				}
				cancelLabel={t("common.cancel")}
				confirmLabel={t("itsmPage.action.delete")}
				busy={busy}
				onCancel={() => {
					if (!busy) setPendingDelete(null);
				}}
				onConfirm={() => {
					if (pendingDelete) void remove(pendingDelete);
				}}
				closeOnBackdrop={!busy}
			/>
		</div>
	);
}
