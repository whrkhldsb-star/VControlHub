"use client";

import { useState } from "react";

import { ActionButton } from "@/components/action-button";
import { FormField } from "@/components/ui-primitives";
import { csrfFetch } from "@/lib/auth/csrf-client";
import { useI18n } from "@/lib/i18n/use-locale";
import { UI_INPUT } from "@/lib/ui/classes";
import { cn } from "@/lib/ui/cn";

import type { PlaybookOption, ServerOption } from "./alert-rule-types";

const selectClass = cn(UI_INPUT, "py-2.5");
const chipActive =
	"border-[var(--color-action-border)]/30 bg-[var(--color-action-bg)]/10 text-[var(--text-secondary)]";
const chipIdle =
	"border-[var(--border)] bg-[var(--surface-elevated)] text-[var(--text-muted)] hover:bg-[var(--surface-hover)]";

export function CreateRuleForm({
	servers,
	playbooks,
	onClose,
}: {
	servers: ServerOption[];
	playbooks: PlaybookOption[];
	onClose: () => void;
}) {
	const { t } = useI18n();
	const [name, setName] = useState("");
	const [metric, setMetric] = useState("cpu_usage");
	const [operator, setOperator] = useState("gte");
	const [threshold, setThreshold] = useState(85);
	const [durationSeconds, setDurationSeconds] = useState(0);
	const [selectedServerIds, setSelectedServerIds] = useState<string[]>([]);
	const [selectedPlaybookIds, setSelectedPlaybookIds] = useState<string[]>([]);
	const [cooldown, setCooldown] = useState(30);
	const [silenceWindowsText, setSilenceWindowsText] = useState("");
	const [channels, setChannels] = useState<string[]>(["in_app"]);
	const [webhookUrl, setWebhookUrl] = useState("");
	const [submitting, setSubmitting] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const toggleChannel = (ch: string) => {
		setChannels((prev) =>
			prev.includes(ch) ? prev.filter((c) => c !== ch) : [...prev, ch],
		);
	};
	const toggleServer = (serverId: string) => {
		setSelectedServerIds((prev) =>
			prev.includes(serverId) ? prev.filter((id) => id !== serverId) : [...prev, serverId],
		);
	};
	const togglePlaybook = (playbookId: string) => {
		setSelectedPlaybookIds((prev) =>
			prev.includes(playbookId)
				? prev.filter((id) => id !== playbookId)
				: [...prev, playbookId],
		);
	};

	const handleSubmit = async (e: React.FormEvent) => {
		e.preventDefault();
		setSubmitting(true);
		setError(null);
		const silenceWindows = silenceWindowsText
			.split(/[\n,，]+/)
			.map((item) => item.trim())
			.filter(Boolean);
		try {
			await csrfFetch("/api/alert-rules", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					name,
					metric,
					operator,
					threshold,
					durationSeconds,
					serverIds: selectedServerIds,
					playbookIds: selectedPlaybookIds,
					notifyChannels: channels,
					cooldownMinutes: cooldown,
					silenceWindows,
					webhookUrl:
						channels.includes("webhook") && webhookUrl.trim()
							? webhookUrl.trim()
							: undefined,
				}),
			});
			onClose();
		} catch (err) {
			setError(err instanceof Error ? err.message : t("alertRulesPage.createForm.error"));
		} finally {
			setSubmitting(false);
		}
	};

	return (
		<form onSubmit={handleSubmit} data-card className="space-y-4">
			<h3 className="text-lg font-semibold text-[var(--text-primary)]">
				{t("alertRulesPage.createForm.title")}
			</h3>
			{error && (
				<div className="rounded-lg border border-[var(--danger-border)] bg-[var(--danger)]/[0.10] px-3.5 py-2.5 text-sm text-[var(--danger)]">
					{error}
				</div>
			)}

			<FormField label={t("alertRulesPage.createForm.name")} htmlFor="alertRuleName">
				<input
					id="alertRuleName"
					value={name}
					onChange={(e) => setName(e.target.value)}
					required
					placeholder={t("alertRulesPage.createForm.namePlaceholder")}
					className={UI_INPUT}
				/>
			</FormField>

			<div className="grid gap-3 sm:grid-cols-3">
				<FormField label={t("alertRulesPage.createForm.metric")} htmlFor="alertRuleMetric">
					<select
						id="alertRuleMetric"
						value={metric}
						onChange={(e) => setMetric(e.target.value)}
						className={selectClass}
					>
						<option value="cpu_usage">{t("alertRulesPage.createForm.metric.cpu_usage")}</option>
						<option value="mem_usage">{t("alertRulesPage.createForm.metric.mem_usage")}</option>
						<option value="disk_usage">{t("alertRulesPage.createForm.metric.disk_usage")}</option>
						<option value="server_offline">{t("alertRulesPage.createForm.metric.server_offline")}</option>
						<option value="network_in">{t("alertRulesPage.createForm.metric.network_in")}</option>
						<option value="network_out">{t("alertRulesPage.createForm.metric.network_out")}</option>
						<option value="load_avg">{t("alertRulesPage.createForm.metric.load_avg")}</option>
						<option value="swap_usage">{t("alertRulesPage.createForm.metric.swap_usage")}</option>
					</select>
				</FormField>
				{metric !== "server_offline" && (
					<FormField label={t("alertRulesPage.createForm.operator")} htmlFor="alertRuleOperator">
						<select
							id="alertRuleOperator"
							value={operator}
							onChange={(e) => setOperator(e.target.value)}
							className={selectClass}
						>
							<option value="gt">{t("alertRulesPage.createForm.operator.gt")}</option>
							<option value="gte">{t("alertRulesPage.createForm.operator.gte")}</option>
							<option value="lt">{t("alertRulesPage.createForm.operator.lt")}</option>
							<option value="lte">{t("alertRulesPage.createForm.operator.lte")}</option>
						</select>
					</FormField>
				)}
				{metric !== "server_offline" && (
					<FormField label={t("alertRulesPage.createForm.threshold")} htmlFor="alertThreshold">
						<input
							id="alertThreshold"
							type="number"
							value={threshold}
							onChange={(e) => setThreshold(Number(e.target.value))}
							min={0}
							max={100}
							className={cn(UI_INPUT, "font-mono")}
						/>
					</FormField>
				)}
			</div>

			<div className="grid gap-3 sm:grid-cols-2">
				<FormField
					label={t("alertRulesPage.createForm.duration")}
					htmlFor="alertDurationSeconds"
					hint={t("alertRulesPage.createForm.durationHint")}
				>
					<input
						id="alertDurationSeconds"
						type="number"
						value={durationSeconds}
						onChange={(e) => setDurationSeconds(Number(e.target.value))}
						min={0}
						className={cn(UI_INPUT, "font-mono")}
					/>
				</FormField>
				<div className="space-y-1.5">
					<label className="text-xs font-medium tracking-wide text-[var(--text-primary)]/70">
						{t("alertRulesPage.createForm.targetNodes")}
					</label>
					<div className="flex flex-wrap gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--surface-elevated)] p-2">
						{servers.length === 0 ? (
							<span className="text-xs text-[var(--text-muted)]">
								{t("alertRulesPage.createForm.noNodes")}
							</span>
						) : (
							<>
								<button
									type="button"
									onClick={() => setSelectedServerIds([])}
									className={cn(
										"rounded-lg border px-2.5 py-1 text-[11px] transition",
										selectedServerIds.length === 0 ? chipActive : chipIdle,
									)}
								>
									{t("alertRulesPage.createForm.allNodes")}
								</button>
								{servers.map((server) => (
									<button
										key={server.id}
										type="button"
										onClick={() => toggleServer(server.id)}
										className={cn(
											"rounded-lg border px-2.5 py-1 text-[11px] transition",
											selectedServerIds.includes(server.id) ? chipActive : chipIdle,
										)}
									>
										{server.name}
									</button>
								))}
							</>
						)}
					</div>
				</div>
			</div>

			<div className="space-y-1.5 rounded-xl border border-[var(--border)] bg-[var(--surface-elevated)] p-3">
				<label className="text-xs font-medium tracking-wide text-[var(--text-primary)]/70">
					{t("alertRulesPage.createForm.playbooks")}
				</label>
				<p className="text-xs text-[var(--text-muted)]">
					{t("alertRulesPage.createForm.playbooksHint")}
				</p>
				<div className="mt-2 flex flex-wrap gap-1.5">
					{playbooks.length === 0 ? (
						<span className="text-xs text-[var(--text-muted)]">
							{t("alertRulesPage.createForm.noPlaybooks")}
						</span>
					) : (
						playbooks.map((playbook) => (
							<button
								key={playbook.id}
								type="button"
								onClick={() => togglePlaybook(playbook.id)}
								disabled={!playbook.enabled}
								className={cn(
									"rounded-lg border px-2.5 py-1 text-[11px] transition disabled:cursor-not-allowed disabled:opacity-50",
									selectedPlaybookIds.includes(playbook.id) ? chipActive : chipIdle,
								)}
							>
								{playbook.name}
								{!playbook.enabled
									? ` · ${t("alertRulesPage.createForm.playbookDisabled")}`
									: ""}
							</button>
						))
					)}
				</div>
			</div>

			<div className="space-y-1.5">
				<label className="text-xs font-medium tracking-wide text-[var(--text-primary)]/70">
					{t("alertRulesPage.createForm.channels")}
				</label>
				<div className="flex flex-wrap gap-2">
					{[
						{ key: "in_app", i18nKey: "alertRulesPage.createForm.channel.in_app" },
						{ key: "email", i18nKey: "alertRulesPage.createForm.channel.email" },
						{ key: "telegram", i18nKey: "alertRulesPage.createForm.channel.telegram" },
						{ key: "webhook", i18nKey: "alertRulesPage.createForm.channel.webhook" },
					].map(({ key, i18nKey }) => (
						<button
							key={key}
							type="button"
							onClick={() => toggleChannel(key)}
							className={cn(
								"rounded-lg border px-3 py-1.5 text-xs font-medium transition",
								channels.includes(key) ? chipActive : chipIdle,
							)}
						>
							{t(i18nKey)}
						</button>
					))}
				</div>
			</div>

			{channels.includes("webhook") && (
				<FormField
					label={t("alertRulesPage.createForm.webhookUrl")}
					htmlFor="alertRuleWebhookUrl"
				>
					<input
						id="alertRuleWebhookUrl"
						value={webhookUrl}
						onChange={(e) => setWebhookUrl(e.target.value)}
						placeholder="https://hooks.example.com/..."
						className={cn(UI_INPUT, "font-mono")}
					/>
				</FormField>
			)}

			<FormField label={t("alertRulesPage.createForm.cooldown")} htmlFor="alertRuleCooldown">
				<input
					id="alertRuleCooldown"
					type="number"
					value={cooldown}
					onChange={(e) => setCooldown(Number(e.target.value))}
					min={1}
					className={cn(UI_INPUT, "w-32 font-mono")}
				/>
			</FormField>

			<FormField
				label={t("alertRulesPage.createForm.silenceWindows")}
				htmlFor="alertSilenceWindows"
				hint={t("alertRulesPage.createForm.silenceWindowsHint")}
			>
				<textarea
					id="alertSilenceWindows"
					value={silenceWindowsText}
					onChange={(e) => setSilenceWindowsText(e.target.value)}
					rows={2}
					placeholder={t("alertRulesPage.createForm.silenceWindowsPlaceholder")}
					className={cn(UI_INPUT, "font-mono")}
				/>
			</FormField>

			<div className="flex gap-3 pt-2">
				<button
					type="submit"
					disabled={submitting}
					data-action-button
					data-variant="primary"
					className="px-5 text-sm"
				>
					{submitting
						? t("alertRulesPage.createForm.submitting")
						: t("alertRulesPage.createForm.submit")}
				</button>
				<ActionButton type="button" variant="secondary" onClick={onClose} className="px-5 text-sm">
					{t("alertRulesPage.createForm.cancel")}
				</ActionButton>
			</div>
		</form>
	);
}
