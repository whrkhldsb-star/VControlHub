"use client";

import { useEffect, useRef, useState } from "react";

import { ActionButton } from "@/components/action-button";
import { useToast } from "@/components/toast-provider";
import { CheckboxField, Notice } from "@/components/ui-primitives";
import { csrfFetch } from "@/lib/auth/csrf-client";
import { useUnsavedChangesGuard } from "@/lib/forms/use-unsaved-changes-guard";
import { getErrorMessage } from "@/lib/http/error-message";
import { useI18n } from "@/lib/i18n/use-locale";
import type { ItsmDirection, ItsmProvider } from "@/lib/itsm/types";
import { UI_INPUT } from "@/lib/ui/classes";

const PROVIDERS: ItsmProvider[] = ["generic_webhook", "slack", "telegram", "dingtalk", "feishu"];
const DIRECTIONS: ItsmDirection[] = ["bidirectional", "outbound", "inbound"];

const EMPTY = {
	name: "",
	provider: "generic_webhook" as ItsmProvider,
	direction: "bidirectional" as ItsmDirection,
	webhookUrl: "",
	chatId: "",
	webhookSecret: "",
	botToken: "",
	workspace: "",
	createOnInbound: true,
};

/**
 * The fields of a new ITSM/IM connection; its panel (title, card) is the page's. A refusal is said here, where the
 * connection was described, and the form closes once the connection exists.
 */
export function ItsmConnectionForm({ onCreated, onClose }: {
	/** Reads the connections again: the new one joins the list. */
	onCreated: () => Promise<void> | void;
	/** Closes the form: after the connection is created, or on Cancel (which asks first when something was typed). */
	onClose: () => void;
}) {
	const { t } = useI18n();
	const { addToast } = useToast();
	const [form, setForm] = useState(EMPTY);
	// What the fields hold now, read when a save answers (the fields stay editable while it runs).
	const latest = useRef(form);
	useEffect(() => {
		latest.current = form;
	}, [form]);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [dirty, setDirty] = useState(false);
	const { requestDiscard, discardDialog } = useUnsavedChangesGuard({ dirty, onDiscard: onClose });
	const edit = (patch: Partial<typeof EMPTY>) => {
		setDirty(true);
		setForm((current) => ({ ...current, ...patch }));
	};

	const create = async (event: React.FormEvent<HTMLFormElement>) => {
		event.preventDefault();
		if (!form.name.trim()) return;
		const submitted = form;
		setBusy(true);
		setError(null);
		try {
			// Only what the chosen channel uses. A field hidden by a change of channel keeps what was typed into it:
			// sent along, it gave a Telegram connection the webhook address typed for Slack (and listed it), and a
			// Slack connection a bot token to store.
			const telegram = form.provider === "telegram";
			const body: Record<string, unknown> = {
				name: form.name.trim(),
				provider: form.provider,
				direction: form.direction,
				credentials: {
					...(form.webhookSecret.trim() ? { webhookSecret: form.webhookSecret.trim() } : {}),
					...(telegram && form.botToken.trim() ? { botToken: form.botToken.trim() } : {}),
				},
				config: {
					...(!telegram && form.webhookUrl.trim() ? { webhookUrl: form.webhookUrl.trim() } : {}),
					...(telegram && form.chatId.trim() ? { chatId: form.chatId.trim() } : {}),
					...(form.workspace.trim() ? { workspace: form.workspace.trim() } : {}),
					createOnInbound: form.createOnInbound,
				},
			};
			await csrfFetch("/api/itsm/connections", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(body),
			});
			addToast("success", t("itsmPage.toast.created"));
			await onCreated();
			// The fields stay editable while saving. Unchanged since, the form closes; a next connection typed
			// meanwhile stays, with only what was sent cleared.
			const now = latest.current;
			if ((Object.keys(submitted) as (keyof typeof EMPTY)[]).every((key) => now[key] === submitted[key])) {
				setDirty(false);
				onClose();
				return;
			}
			const sentOrKept = (value: string, sent: string) => (value === sent ? "" : value);
			setForm((current) => ({
				...current,
				name: sentOrKept(current.name, submitted.name),
				webhookUrl: sentOrKept(current.webhookUrl, submitted.webhookUrl),
				chatId: sentOrKept(current.chatId, submitted.chatId),
				webhookSecret: sentOrKept(current.webhookSecret, submitted.webhookSecret),
				botToken: sentOrKept(current.botToken, submitted.botToken),
			}));
		} catch (err) {
			setError(getErrorMessage(err, t("itsmPage.form.error")));
		} finally {
			setBusy(false);
		}
	};

	return (
		<form onSubmit={(event) => void create(event)} className="space-y-4">
			{error ? <Notice tone="danger" compact>{error}</Notice> : null}
			<div className="grid gap-3 md:grid-cols-2">
				<label className="ui-label space-y-1">
					<span>{t("itsmPage.field.name")}</span>
					<input
						className={UI_INPUT}
						value={form.name}
						onChange={(e) => edit({ name: e.target.value })}
						placeholder={t("itsmPage.field.namePlaceholder")}
					/>
				</label>
				<label className="ui-label space-y-1">
					<span>{t("itsmPage.field.provider")}</span>
					<select className={UI_INPUT} value={form.provider} onChange={(e) => edit({ provider: e.target.value as ItsmProvider })}>
						{PROVIDERS.map((p) => (
							<option key={p} value={p}>
								{t(`itsmPage.provider.${p}`)}
							</option>
						))}
					</select>
				</label>
				<label className="ui-label space-y-1">
					<span>{t("itsmPage.field.direction")}</span>
					<select className={UI_INPUT} value={form.direction} onChange={(e) => edit({ direction: e.target.value as ItsmDirection })}>
						{DIRECTIONS.map((d) => (
							<option key={d} value={d}>
								{t(`itsmPage.direction.${d}`)}
							</option>
						))}
					</select>
				</label>
				<label className="ui-label space-y-1">
					<span>{t("itsmPage.field.workspace")}</span>
					<input className={UI_INPUT} value={form.workspace} onChange={(e) => edit({ workspace: e.target.value })} />
				</label>
				{form.provider !== "telegram" && (
					<label className="ui-label space-y-1 md:col-span-2">
						<span>{t("itsmPage.field.webhookUrl")}</span>
						<input
							className={UI_INPUT}
							value={form.webhookUrl}
							onChange={(e) => edit({ webhookUrl: e.target.value })}
							placeholder="https://hooks.example.com/..."
						/>
					</label>
				)}
				{form.provider === "telegram" && (
					<>
						<label className="ui-label space-y-1">
							<span>{t("itsmPage.field.botToken")}</span>
							{/* A secret: hidden while typed, and not kept by the browser's form history. */}
							<input
								type="password"
								autoComplete="new-password"
								className={UI_INPUT}
								value={form.botToken}
								onChange={(e) => edit({ botToken: e.target.value })}
							/>
						</label>
						<label className="ui-label space-y-1">
							<span>{t("itsmPage.field.chatId")}</span>
							<input className={UI_INPUT} value={form.chatId} onChange={(e) => edit({ chatId: e.target.value })} />
						</label>
					</>
				)}
				<label className="ui-label space-y-1 md:col-span-2">
					<span>{t("itsmPage.field.webhookSecret")}</span>
					<input
						type="password"
						autoComplete="new-password"
						className={UI_INPUT}
						value={form.webhookSecret}
						onChange={(e) => edit({ webhookSecret: e.target.value })}
						placeholder={t("itsmPage.field.webhookSecretPlaceholder")}
					/>
				</label>
				<CheckboxField
					checked={form.createOnInbound}
					onChange={(e: React.ChangeEvent<HTMLInputElement>) => edit({ createOnInbound: e.target.checked })}
					label={t("itsmPage.field.createOnInbound")}
					className="md:col-span-2"
				/>
			</div>
			<div className="flex flex-wrap gap-3">
				<ActionButton type="submit" variant="primary" disabled={busy || !form.name.trim()}>
					{t("itsmPage.form.submit")}
				</ActionButton>
				<ActionButton type="button" variant="secondary" disabled={busy} onClick={requestDiscard}>
					{t("common.cancel")}
				</ActionButton>
			</div>
			{discardDialog}
		</form>
	);
}
