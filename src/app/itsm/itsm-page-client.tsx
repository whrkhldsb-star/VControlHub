"use client";

import { useCallback, useState } from "react";

import { ActionButton } from "@/components/action-button";
import { csrfFetch } from "@/lib/auth/csrf-client";
import type { ItsmConnectionRecord, ItsmDirection, ItsmEventRecord, ItsmProvider } from "@/lib/itsm/types";
import { useI18n } from "@/lib/i18n/use-locale";
import { useToast } from "@/components/toast-provider";

const PROVIDERS: ItsmProvider[] = ["generic_webhook", "slack", "telegram", "dingtalk", "feishu"];
const DIRECTIONS: ItsmDirection[] = ["bidirectional", "outbound", "inbound"];

const cardClass = "rounded-xl border border-border/60 bg-card/40 p-4 space-y-3";
const inputClass =
	"w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-cyan-500/40";

type Props = {
	initialConnections: ItsmConnectionRecord[];
	initialEvents: ItsmEventRecord[];
	canManage: boolean;
	publicBaseUrl: string;
};

export function ItsmPageClient({
	initialConnections,
	initialEvents,
	canManage,
	publicBaseUrl,
}: Props) {
	const { t } = useI18n();
	const { addToast } = useToast();
	const [connections, setConnections] = useState(initialConnections);
	const [events, setEvents] = useState(initialEvents);
	const [busy, setBusy] = useState(false);
	const [testingId, setTestingId] = useState<string | null>(null);
	const [form, setForm] = useState({
		name: "",
		provider: "generic_webhook" as ItsmProvider,
		direction: "bidirectional" as ItsmDirection,
		webhookUrl: "",
		chatId: "",
		webhookSecret: "",
		botToken: "",
		workspace: "",
		createOnInbound: true,
	});

	const reload = useCallback(async () => {
		const [connData, eventData] = await Promise.all([
			csrfFetch("/api/itsm/connections") as Promise<{ connections?: ItsmConnectionRecord[] }>,
			csrfFetch("/api/itsm/events?limit=30") as Promise<{ events?: ItsmEventRecord[] }>,
		]);
		if (Array.isArray(connData.connections)) setConnections(connData.connections);
		if (Array.isArray(eventData.events)) setEvents(eventData.events);
	}, []);

	const create = async () => {
		if (!form.name.trim()) return;
		setBusy(true);
		try {
			const body: Record<string, unknown> = {
				name: form.name.trim(),
				provider: form.provider,
				direction: form.direction,
				credentials: {
					...(form.webhookSecret.trim() ? { webhookSecret: form.webhookSecret.trim() } : {}),
					...(form.botToken.trim() ? { botToken: form.botToken.trim() } : {}),
				},
				config: {
					...(form.webhookUrl.trim() ? { webhookUrl: form.webhookUrl.trim() } : {}),
					...(form.chatId.trim() ? { chatId: form.chatId.trim() } : {}),
					...(form.workspace.trim() ? { workspace: form.workspace.trim() } : {}),
					createOnInbound: form.createOnInbound,
				},
			};
			await csrfFetch("/api/itsm/connections", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(body),
			});
			setForm((c) => ({
				...c,
				name: "",
				webhookUrl: "",
				chatId: "",
				webhookSecret: "",
				botToken: "",
			}));
			await reload();
			addToast("success", t("itsmPage.toast.created"));
		} catch (error) {
			addToast("error", error instanceof Error ? error.message : t("itsmPage.toast.error"));
		} finally {
			setBusy(false);
		}
	};

	const remove = async (id: string) => {
		setBusy(true);
		try {
			await csrfFetch(`/api/itsm/connections/${id}`, { method: "DELETE" });
			await reload();
			addToast("success", t("itsmPage.toast.deleted"));
		} catch (error) {
			addToast("error", error instanceof Error ? error.message : t("itsmPage.toast.error"));
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
			addToast("error", error instanceof Error ? error.message : t("itsmPage.toast.testFail"));
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
			addToast("error", error instanceof Error ? error.message : t("itsmPage.toast.error"));
		} finally {
			setBusy(false);
		}
	};

	return (
		<div className="space-y-6">
			{canManage && (
				<section className={cardClass}>
					<h2 className="text-base font-semibold">{t("itsmPage.form.title")}</h2>
					<p className="text-sm text-muted-foreground">{t("itsmPage.form.desc")}</p>
					<div className="grid gap-3 md:grid-cols-2">
						<label className="space-y-1 text-sm">
							<span>{t("itsmPage.field.name")}</span>
							<input
								className={inputClass}
								value={form.name}
								onChange={(e) => setForm((c) => ({ ...c, name: e.target.value }))}
								placeholder={t("itsmPage.field.namePlaceholder")}
							/>
						</label>
						<label className="space-y-1 text-sm">
							<span>{t("itsmPage.field.provider")}</span>
							<select
								className={inputClass}
								value={form.provider}
								onChange={(e) =>
									setForm((c) => ({ ...c, provider: e.target.value as ItsmProvider }))
								}
							>
								{PROVIDERS.map((p) => (
									<option key={p} value={p}>
										{t(`itsmPage.provider.${p}`)}
									</option>
								))}
							</select>
						</label>
						<label className="space-y-1 text-sm">
							<span>{t("itsmPage.field.direction")}</span>
							<select
								className={inputClass}
								value={form.direction}
								onChange={(e) =>
									setForm((c) => ({ ...c, direction: e.target.value as ItsmDirection }))
								}
							>
								{DIRECTIONS.map((d) => (
									<option key={d} value={d}>
										{t(`itsmPage.direction.${d}`)}
									</option>
								))}
							</select>
						</label>
						<label className="space-y-1 text-sm">
							<span>{t("itsmPage.field.workspace")}</span>
							<input
								className={inputClass}
								value={form.workspace}
								onChange={(e) => setForm((c) => ({ ...c, workspace: e.target.value }))}
							/>
						</label>
						{form.provider !== "telegram" && (
							<label className="space-y-1 text-sm md:col-span-2">
								<span>{t("itsmPage.field.webhookUrl")}</span>
								<input
									className={inputClass}
									value={form.webhookUrl}
									onChange={(e) => setForm((c) => ({ ...c, webhookUrl: e.target.value }))}
									placeholder="https://hooks.example.com/..."
								/>
							</label>
						)}
						{form.provider === "telegram" && (
							<>
								<label className="space-y-1 text-sm">
									<span>{t("itsmPage.field.botToken")}</span>
									<input
										className={inputClass}
										value={form.botToken}
										onChange={(e) => setForm((c) => ({ ...c, botToken: e.target.value }))}
									/>
								</label>
								<label className="space-y-1 text-sm">
									<span>{t("itsmPage.field.chatId")}</span>
									<input
										className={inputClass}
										value={form.chatId}
										onChange={(e) => setForm((c) => ({ ...c, chatId: e.target.value }))}
									/>
								</label>
							</>
						)}
						<label className="space-y-1 text-sm md:col-span-2">
							<span>{t("itsmPage.field.webhookSecret")}</span>
							<input
								className={inputClass}
								value={form.webhookSecret}
								onChange={(e) => setForm((c) => ({ ...c, webhookSecret: e.target.value }))}
								placeholder={t("itsmPage.field.webhookSecretPlaceholder")}
							/>
						</label>
						<label className="flex items-center gap-2 text-sm md:col-span-2">
							<input
								type="checkbox"
								checked={form.createOnInbound}
								onChange={(e) => setForm((c) => ({ ...c, createOnInbound: e.target.checked }))}
							/>
							<span>{t("itsmPage.field.createOnInbound")}</span>
						</label>
					</div>
					<div className="flex justify-end">
						<ActionButton disabled={busy || !form.name.trim()} onClick={() => void create()}>
							{t("itsmPage.form.submit")}
						</ActionButton>
					</div>
				</section>
			)}

			<section className={cardClass}>
				<div className="flex items-center justify-between gap-2">
					<h2 className="text-base font-semibold">
						{t("itsmPage.list.title")} ({connections.length})
					</h2>
					<button
						type="button"
						className="text-xs text-cyan-500 hover:underline"
						onClick={() => void reload()}
					>
						{t("itsmPage.list.refresh")}
					</button>
				</div>
				{connections.length === 0 ? (
					<p className="text-sm text-muted-foreground">{t("itsmPage.list.empty")}</p>
				) : (
					<ul className="space-y-3">
						{connections.map((row) => (
							<li
								key={row.id}
								className="rounded-lg border border-border/50 bg-background/40 p-3 space-y-2"
							>
								<div className="flex flex-wrap items-center justify-between gap-2">
									<div>
										<div className="font-medium">
											{row.name}{" "}
											<span className="text-xs text-muted-foreground">
												{t(`itsmPage.provider.${row.provider}`)} ·{" "}
												{t(`itsmPage.direction.${row.direction}`)}
											</span>
										</div>
										<div className="text-xs text-muted-foreground">
											{row.enabled ? t("itsmPage.status.enabled") : t("itsmPage.status.disabled")}
											{row.lastError ? ` · ${row.lastError}` : ""}
										</div>
									</div>
									{canManage && (
										<div className="flex flex-wrap gap-2">
											<button
												type="button"
												className="rounded-md border px-2 py-1 text-xs"
												disabled={busy}
												onClick={() => void toggleEnabled(row)}
											>
												{row.enabled ? t("itsmPage.action.disable") : t("itsmPage.action.enable")}
											</button>
											<button
												type="button"
												className="rounded-md border px-2 py-1 text-xs"
												disabled={testingId === row.id}
												onClick={() => void test(row.id)}
											>
												{testingId === row.id
													? t("itsmPage.action.testing")
													: t("itsmPage.action.test")}
											</button>
											<button
												type="button"
												className="rounded-md border border-rose-500/40 px-2 py-1 text-xs text-rose-500"
												disabled={busy}
												onClick={() => void remove(row.id)}
											>
												{t("itsmPage.action.delete")}
											</button>
										</div>
									)}
								</div>
								{(row.direction === "inbound" || row.direction === "bidirectional") && (
									<div className="rounded-md bg-muted/40 p-2 text-xs font-mono break-all">
										{t("itsmPage.inboundUrl")}: {publicBaseUrl}/api/itsm/inbound/{row.id}
									</div>
								)}
								{row.config.webhookUrl && (
									<div className="text-xs text-muted-foreground break-all">
										{t("itsmPage.field.webhookUrl")}: {row.config.webhookUrl}
									</div>
								)}
							</li>
						))}
					</ul>
				)}
			</section>

			<section className={cardClass}>
				<h2 className="text-base font-semibold">{t("itsmPage.events.title")}</h2>
				{events.length === 0 ? (
					<p className="text-sm text-muted-foreground">{t("itsmPage.events.empty")}</p>
				) : (
					<ul className="space-y-2 max-h-96 overflow-auto text-sm">
						{events.map((ev) => (
							<li key={ev.id} className="border-b border-border/40 py-2 last:border-0">
								<div className="flex flex-wrap justify-between gap-2">
									<span>
										{ev.direction} · {ev.eventType} · {ev.status}
									</span>
									<span className="text-xs text-muted-foreground">
										{new Date(ev.createdAt).toLocaleString()}
									</span>
								</div>
								{ev.ticketId && (
									<div className="text-xs text-muted-foreground">ticket: {ev.ticketId}</div>
								)}
								{ev.errorMessage && (
									<div className="text-xs text-rose-500">{ev.errorMessage}</div>
								)}
							</li>
						))}
					</ul>
				)}
			</section>
		</div>
	);
}
