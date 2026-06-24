"use client";

import { useCallback, useState } from "react";
import { csrfFetch } from "@/lib/auth/csrf-client";
import { useI18n } from "@/lib/i18n/use-locale";
import { useToast } from "@/components/toast-provider";
import { EmptyState } from "@/components/page-shell";

type TriggerType = "cron" | "metric";
type StepType = "run_command" | "send_notification" | "call_webhook";

type SerializedStep = {
	id: string;
	name: string;
	type: StepType;
	config: Record<string, unknown>;
	retry: number;
	timeoutSec: number;
};

type SerializedPlaybook = {
	id: string;
	name: string;
	description: string | null;
	triggerType: TriggerType;
	triggerConfig: Record<string, unknown>;
	steps: SerializedStep[];
	chainRetry: number;
	enabled: boolean;
	createdAt: string;
};

type RunSummary = {
	id: string;
	status: string;
	dryRun: boolean;
	startedAt: string | null;
	completedAt: string | null;
	errorMessage: string | null;
};

type Props = {
	playbooks: SerializedPlaybook[];
	runsByPlaybook: Record<string, RunSummary[]>;
	canManage: boolean;
	canRun: boolean;
};

const fieldLabelClass = "text-xs font-medium text-slate-300 tracking-wide";
const fieldInputClass = "w-full rounded-lg border border-white/[0.06] bg-white/[0.04] px-3.5 py-2.5 text-sm text-white outline-none transition placeholder:text-white/20 focus:border-cyan-400/30";
const monoFieldInputClass = `${fieldInputClass} font-mono`;

function stepTypeLabel(t: (k: string) => string, type: StepType): string {
	return t(`playbooksPage.stepType.${type}`);
}

function statusLabelFor(t: (k: string) => string, status: string): string {
	switch (status) {
		case "completed":
			return t("playbooksPage.status.completed");
		case "failed":
			return t("playbooksPage.status.failed");
		case "running":
			return t("playbooksPage.status.running");
		case "queued":
			return t("playbooksPage.status.queued");
		case "cancelled":
			return t("playbooksPage.status.cancelled");
		default:
			return status;
	}
}

function formatTime(iso: string | null): string {
	if (!iso) return "—";
	return new Date(iso).toLocaleString("zh-CN");
}

function defaultConfigFor(type: StepType): Record<string, unknown> {
	if (type === "run_command") return { command: "", serverIds: [] as string[] };
	if (type === "send_notification") return { recipientUserId: "", subject: "", body: "" };
	return { url: "https://", method: "POST" as const };
}

function makeNewStep(): SerializedStep {
	const id = `step-${Math.random().toString(36).slice(2, 9)}`;
	return {
		id,
		name: "",
		type: "run_command",
		config: defaultConfigFor("run_command"),
		retry: 0,
		timeoutSec: 60,
	};
}

export function PlaybookListClient({ playbooks: initial, runsByPlaybook: initialRuns, canManage, canRun }: Props) {
	const { t } = useI18n();
	const { addToast } = useToast();
	const [playbooks, setPlaybooks] = useState(initial);
	const [runsByPlaybook, setRunsByPlaybook] = useState(initialRuns);
	const [showCreate, setShowCreate] = useState(false);
	const [pendingDelete, setPendingDelete] = useState<SerializedPlaybook | null>(null);
	const [actionError, setActionError] = useState<string | null>(null);
	const [busyAction, setBusyAction] = useState<string | null>(null);

	const refresh = useCallback(async () => {
		const data = await csrfFetch<{ playbooks: SerializedPlaybook[] }>("/api/playbooks");
		setPlaybooks(data.playbooks ?? []);
	}, []);

	const handleTrigger = useCallback(
		async (id: string, kind: "run" | "dry-run") => {
			setActionError(null);
			setBusyAction(`${kind}:${id}`);
			try {
				const result = await csrfFetch<{ run: RunSummary }>(`/api/playbooks/${id}/${kind}`, { method: "POST" });
				const run = result.run;
				setRunsByPlaybook((prev) => ({
					...prev,
					[id]: [run, ...(prev[id] ?? [])].slice(0, 5),
				}));
				if (kind === "dry-run") {
					addToast("success", t("playbooksPage.toast.dryRun").replace("{ok}", "0").replace("{total}", "0"));
				} else {
					addToast(
						run.status === "failed" ? "error" : "success",
						t("playbooksPage.toast.run").replace("{status}", statusLabelFor(t, run.status)),
					);
				}
			} catch (err) {
				setActionError(err instanceof Error ? err.message : t("playbooksPage.error.load"));
			} finally {
				setBusyAction(null);
			}
		},
		[addToast, t],
	);

	const handleToggle = useCallback(
		async (playbook: SerializedPlaybook) => {
			setActionError(null);
			setBusyAction(`toggle:${playbook.id}`);
			try {
				await csrfFetch(`/api/playbooks/${playbook.id}`, {
					method: "PATCH",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ id: playbook.id, enabled: !playbook.enabled }),
				});
				void refresh();
			} catch (err) {
				setActionError(err instanceof Error ? err.message : t("playbooksPage.error.toggle"));
			} finally {
				setBusyAction(null);
			}
		},
		[refresh, t],
	);

	const handleDelete = useCallback(
		async (playbook: SerializedPlaybook) => {
			setActionError(null);
			setBusyAction(`delete:${playbook.id}`);
			try {
				await csrfFetch(`/api/playbooks/${playbook.id}`, { method: "DELETE" });
				setPendingDelete(null);
				void refresh();
			} catch (err) {
				setActionError(err instanceof Error ? err.message : t("playbooksPage.error.delete"));
			} finally {
				setBusyAction(null);
			}
		},
		[refresh, t],
	);

	const runs = (id: string) => runsByPlaybook[id] ?? [];

	return (
		<div className="space-y-6">
			{actionError && (
				<div role="alert" className="rounded-lg bg-rose-500/[0.08] border border-rose-400/20 px-3.5 py-2.5 text-sm text-rose-200">
					{actionError}
				</div>
			)}
			<div className="flex justify-end">
				{canManage && !showCreate && (
					<button
						type="button"
						onClick={() => setShowCreate(true)}
						data-tone="accent"
						className="min-h-11 rounded-2xl border px-5 py-2.5 text-sm font-medium transition"
					>
						{t("playbooksPage.action.create")}
					</button>
				)}
			</div>

			{showCreate && <CreatePlaybookForm onClose={() => { setShowCreate(false); void refresh(); }} />}

			{playbooks.length === 0 ? (
				<EmptyState icon="🧩" variant="boxed">
					<p>{t("playbooksPage.empty")}</p>
					{canManage && !showCreate && (
						<button
							type="button"
							onClick={() => setShowCreate(true)}
							data-tone="accent"
							className="mt-4 min-h-9 rounded-xl border px-4 py-2 text-sm font-medium transition-colors"
						>
							{t("playbooksPage.action.create")}
						</button>
					)}
				</EmptyState>
			) : (
				<div className="space-y-3">
					{playbooks.map((playbook) => {
						const isRunning = busyAction === `run:${playbook.id}`;
						const isDryRunning = busyAction === `dry-run:${playbook.id}`;
						const isToggling = busyAction === `toggle:${playbook.id}`;
						const isDeleting = busyAction === `delete:${playbook.id}`;
						const playbookRuns = runs(playbook.id);
						return (
							<article key={playbook.id} data-card className="p-5 hover:bg-white/[0.04] transition-colors duration-150">
								<div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
									<div className="min-w-0 flex-1">
										<div className="flex flex-wrap items-center gap-2.5">
											<h2 className="text-lg font-semibold text-white">{playbook.name}</h2>
											<span
												data-tone={playbook.enabled ? "success" : "neutral"}
												className="inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium"
											>
												{playbook.enabled ? t("playbooksPage.status.enabled") : t("playbooksPage.status.disabled")}
											</span>
											<span data-tone="cyan" className="inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium">
												{playbook.triggerType}
											</span>
										</div>
										{playbook.description && (
											<p className="mt-1 text-xs text-slate-400">{playbook.description}</p>
										)}
										<div className="mt-2 text-xs text-slate-500">
											{t("playbooksPage.stepsAndCreatedAt").replace("{count}", String(playbook.steps.length)).replace("{time}", formatTime(playbook.createdAt))}
										</div>
										<details className="mt-3">
											<summary className="cursor-pointer text-xs text-slate-400 hover:text-slate-200">
												{t("playbooksPage.runHistory").replace("{count}", String(playbookRuns.length))}
											</summary>
											<div className="mt-2 space-y-1.5">
												{playbookRuns.length === 0 ? (
													<p className="text-xs text-slate-500">{t("playbooksPage.runHistory.empty")}</p>
												) : (
													playbookRuns.map((r) => (
														<div key={r.id} className="flex items-center gap-2 text-xs text-slate-300">
															<span data-tone={r.status === "failed" ? "danger" : r.status === "completed" ? "success" : "neutral"} className="rounded-full border px-1.5 py-0.5 text-[10px]">
																{statusLabelFor(t, r.status)}{r.dryRun ? " · dry-run" : ""}
															</span>
															<span className="text-slate-500">{formatTime(r.startedAt)}</span>
															{r.errorMessage && <span className="text-rose-300 truncate">{r.errorMessage}</span>}
														</div>
													))
												)}
											</div>
										</details>
									</div>
									<div className="flex flex-col gap-2 shrink-0">
										{canRun && (
											<>
												<button
													type="button"
													onClick={() => handleTrigger(playbook.id, "dry-run")}
													disabled={isDryRunning || isRunning}
													data-tone="accent"
													className="min-h-11 rounded-2xl border px-4 py-2 text-xs font-medium transition disabled:opacity-50"
												>
													{isDryRunning ? t("playbooksPage.action.dryRunRunning") : t("playbooksPage.action.dryRun")}
												</button>
												<button
													type="button"
													onClick={() => handleTrigger(playbook.id, "run")}
													disabled={!playbook.enabled || isRunning || isDryRunning}
													data-tone="accent"
													className="min-h-11 rounded-2xl border px-4 py-2 text-xs font-medium transition disabled:opacity-50"
												>
													{isRunning ? t("playbooksPage.action.running") : t("playbooksPage.action.run")}
												</button>
											</>
										)}
										{canManage && (
											<button
												type="button"
												onClick={() => handleToggle(playbook)}
												disabled={isToggling}
												data-tone="warn"
												className="min-h-11 rounded-2xl border px-4 py-2 text-xs font-medium transition disabled:opacity-50"
											>
												{isToggling ? t("playbooksPage.action.toggling") : t("playbooksPage.action.toggle")}
											</button>
										)}
										{canManage && (
											<button
												type="button"
												onClick={() => setPendingDelete(playbook)}
												disabled={isDeleting}
												data-tone="danger"
												className="min-h-11 rounded-2xl border px-4 py-2 text-xs font-medium transition disabled:opacity-50"
											>
												{isDeleting ? t("playbooksPage.action.deleting") : t("playbooksPage.action.delete")}
											</button>
										)}
									</div>
								</div>
							</article>
						);
					})}
				</div>
			)}

			{pendingDelete && (
				<div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 px-4 backdrop-blur-sm" role="presentation">
					<section
						role="dialog"
						aria-modal="true"
						aria-labelledby="delete-playbook-title"
						className="w-full max-w-md rounded-2xl border border-rose-400/25 bg-slate-950 p-6 shadow-[0_24px_100px_rgba(244,63,94,0.16)]"
					>
						<h2 id="delete-playbook-title" className="text-lg font-semibold text-white">
							{t("playbooksPage.delete.title")}
						</h2>
						<p className="mt-3 text-sm leading-6 text-slate-300">
							{t("playbooksPage.delete.confirm").replace("{name}", pendingDelete.name)}
						</p>
						<div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
							<button
								type="button"
								onClick={() => setPendingDelete(null)}
								className="min-h-11 rounded-xl border border-white/[0.08] px-4 py-2 text-sm font-medium text-slate-200 hover:bg-white/[0.06]"
							>
								{t("playbooksPage.delete.cancel")}
							</button>
							<button
								type="button"
								onClick={() => handleDelete(pendingDelete)}
								disabled={busyAction === `delete:${pendingDelete.id}`}
								className="min-h-11 rounded-xl bg-rose-500 px-4 py-2 text-sm font-semibold text-white hover:bg-rose-400 disabled:opacity-50"
							>
								{busyAction === `delete:${pendingDelete.id}`
									? t("playbooksPage.action.deleting")
									: t("playbooksPage.delete.confirmBtn")}
							</button>
						</div>
					</section>
				</div>
			)}
		</div>
	);
}

function CreatePlaybookForm({ onClose }: { onClose: () => void }) {
	const { t } = useI18n();
	const [name, setName] = useState("");
	const [description, setDescription] = useState("");
	const [triggerType, setTriggerType] = useState<TriggerType>("cron");
	const [cronExpression, setCronExpression] = useState("0 3 * * *");
	const [metricName, setMetricName] = useState("cpu_usage");
	const [metricOperator, setMetricOperator] = useState("gt");
	const [metricThreshold, setMetricThreshold] = useState("80");
	const [chainRetry, setChainRetry] = useState("0");
	const [enabled, setEnabled] = useState(true);
	const [steps, setSteps] = useState<SerializedStep[]>([makeNewStep()]);
	const [submitting, setSubmitting] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const addStep = () => setSteps((prev) => [...prev, makeNewStep()]);
	const removeStep = (id: string) => setSteps((prev) => prev.filter((s) => s.id !== id));
	const updateStep = (id: string, patch: Partial<SerializedStep>) =>
		setSteps((prev) => prev.map((s) => (s.id === id ? { ...s, ...patch } : s)));
	const updateStepConfig = (id: string, patch: Record<string, unknown>) =>
		setSteps((prev) =>
			prev.map((s) => (s.id === id ? { ...s, config: { ...s.config, ...patch } } : s)),
		);

	const handleSubmit = async (e: React.FormEvent) => {
		e.preventDefault();
		setSubmitting(true);
		setError(null);
		try {
			const triggerConfig =
				triggerType === "cron"
					? { expression: cronExpression }
					: { metric: metricName, operator: metricOperator, threshold: Number(metricThreshold) };
			await csrfFetch("/api/playbooks", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					name,
					description: description || null,
					triggerType,
					triggerConfig,
					steps: steps.map((s) => ({
						id: s.id,
						name: s.name,
						type: s.type,
						config: s.config,
						retry: s.retry,
						timeoutSec: s.timeoutSec,
					})),
					chainRetry: Number(chainRetry),
					enabled,
				}),
			});
			onClose();
		} catch (err) {
			setError(err instanceof Error ? err.message : t("playbooksPage.createForm.error"));
		} finally {
			setSubmitting(false);
		}
	};

	return (
		<form onSubmit={handleSubmit} data-card className="p-5 space-y-4">
			<h3 className="text-lg font-semibold text-white">{t("playbooksPage.createForm.title")}</h3>
			{error && (
				<div role="alert" className="rounded-lg bg-rose-500/[0.08] border border-rose-400/20 px-3.5 py-2.5 text-sm text-rose-200">
					{error}
				</div>
			)}

			<div className="grid gap-4 md:grid-cols-2">
				<div className="space-y-1.5">
					<label htmlFor="playbook-name" className={fieldLabelClass}>
						{t("playbooksPage.createForm.name")}
					</label>
					<input
						id="playbook-name"
						value={name}
						onChange={(e) => setName(e.target.value)}
						required
						placeholder={t("playbooksPage.createForm.namePlaceholder")}
						className={fieldInputClass}
					/>
				</div>
				<div className="space-y-1.5">
					<label htmlFor="playbook-chain-retry" className={fieldLabelClass}>
						{t("playbooksPage.createForm.chainRetry")}
					</label>
					<input
						id="playbook-chain-retry"
						type="number"
						min={0}
						max={5}
						value={chainRetry}
						onChange={(e) => setChainRetry(e.target.value)}
						className={fieldInputClass}
					/>
				</div>
			</div>

			<div className="space-y-1.5">
				<label htmlFor="playbook-description" className={fieldLabelClass}>
					{t("playbooksPage.createForm.description")}
				</label>
				<textarea
					id="playbook-description"
					value={description}
					onChange={(e) => setDescription(e.target.value)}
					rows={2}
					className={`${fieldInputClass} resize-y`}
				/>
			</div>

			<div className="space-y-1.5">
				<div id="playbook-trigger-type-label" className={fieldLabelClass}>
					{t("playbooksPage.createForm.triggerType")}
				</div>
				<div className="flex gap-2" role="radiogroup" aria-labelledby="playbook-trigger-type-label">
					{(["cron", "metric"] as const).map((opt) => (
						<label
							key={opt}
							className={`min-h-11 flex items-center gap-2 rounded-lg border px-3 py-2 text-sm cursor-pointer transition ${
								triggerType === opt
									? "border-cyan-400/20 bg-cyan-400/[0.06] text-white"
									: "border-white/[0.06] bg-white/[0.03] text-slate-300 hover:bg-white/[0.05]"
							}`}
						>
							<input
								type="radio"
								name="trigger-type"
								value={opt}
								checked={triggerType === opt}
								onChange={() => setTriggerType(opt)}
								className="accent-cyan-400"
							/>
							<span>{opt === "cron" ? t("playbooksPage.createForm.triggerCron") : t("playbooksPage.createForm.triggerMetric")}</span>
						</label>
					))}
				</div>
			</div>

			{triggerType === "cron" ? (
				<div className="space-y-1.5">
					<label htmlFor="playbook-cron" className={fieldLabelClass}>
						{t("playbooksPage.triggerConfig.cron")}
					</label>
					<input
						id="playbook-cron"
						value={cronExpression}
						onChange={(e) => setCronExpression(e.target.value)}
						required
						placeholder={t("playbooksPage.triggerConfig.cronPlaceholder")}
						className={monoFieldInputClass}
					/>
				</div>
			) : (
				<div className="grid gap-4 md:grid-cols-3">
					<div className="space-y-1.5">
						<label htmlFor="playbook-metric" className={fieldLabelClass}>
							{t("playbooksPage.triggerConfig.metric")}
						</label>
						<select
							id="playbook-metric"
							value={metricName}
							onChange={(e) => setMetricName(e.target.value)}
							className={fieldInputClass}
						>
							<option value="cpu_usage">{t("playbooksPage.metric.cpu_usage")}</option>
							<option value="mem_usage">{t("playbooksPage.metric.mem_usage")}</option>
							<option value="disk_usage">{t("playbooksPage.metric.disk_usage")}</option>
						</select>
					</div>
					<div className="space-y-1.5">
						<label htmlFor="playbook-operator" className={fieldLabelClass}>
							{t("playbooksPage.triggerConfig.operator")}
						</label>
						<select
							id="playbook-operator"
							value={metricOperator}
							onChange={(e) => setMetricOperator(e.target.value)}
							className={fieldInputClass}
						>
							{["gt", "gte", "lt", "lte", "eq"].map((op) => (
								<option key={op} value={op}>
									{t(`playbooksPage.operator.${op}`)}
								</option>
							))}
						</select>
					</div>
					<div className="space-y-1.5">
						<label htmlFor="playbook-threshold" className={fieldLabelClass}>
							{t("playbooksPage.triggerConfig.threshold")}
						</label>
						<input
							id="playbook-threshold"
							type="number"
							step="any"
							value={metricThreshold}
							onChange={(e) => setMetricThreshold(e.target.value)}
							className={fieldInputClass}
						/>
					</div>
				</div>
			)}

			<div className="space-y-2">
				<div className="flex items-center justify-between">
					<div className={fieldLabelClass}>{t("playbooksPage.createForm.stepsTitle")}</div>
					<button
						type="button"
						onClick={addStep}
						data-tone="accent"
						className="min-h-9 rounded-md border px-3 py-1 text-xs transition"
					>
						{t("playbooksPage.createForm.addStep")}
					</button>
				</div>
				<div className="space-y-2">
					{steps.map((step, idx) => (
						<div key={step.id} data-card className="p-3 space-y-2">
							<div className="flex items-center gap-2">
								<span className="text-xs text-slate-500">#{idx + 1}</span>
								<input
									aria-label={t("playbooksPage.createForm.stepName")}
									value={step.name}
									onChange={(e) => updateStep(step.id, { name: e.target.value })}
									placeholder={t("playbooksPage.createForm.stepNamePlaceholder")}
									className={`${fieldInputClass} flex-1`}
									required
								/>
								<select
									aria-label="step type"
									value={step.type}
									onChange={(e) => {
										const newType = e.target.value as StepType;
										updateStep(step.id, { type: newType, config: defaultConfigFor(newType) });
									}}
									className={fieldInputClass}
								>
									{(["run_command", "send_notification", "call_webhook"] as StepType[]).map((tp) => (
										<option key={tp} value={tp}>
											{stepTypeLabel(t, tp)}
										</option>
									))}
								</select>
								{steps.length > 1 && (
									<button
										type="button"
										onClick={() => removeStep(step.id)}
										data-tone="danger"
										className="min-h-9 rounded-md border px-2 py-1 text-xs"
									>
										×
									</button>
								)}
							</div>
							<StepConfigEditor step={step} onConfigChange={(p) => updateStepConfig(step.id, p)} />
							<div className="grid gap-2 md:grid-cols-2">
								<div className="space-y-1">
									<label className="text-[11px] text-slate-400">{t("playbooksPage.createForm.retry")}</label>
									<input
										type="number"
										min={0}
										max={5}
										value={step.retry}
										onChange={(e) => updateStep(step.id, { retry: Number(e.target.value) })}
										className={fieldInputClass}
									/>
								</div>
								<div className="space-y-1">
									<label className="text-[11px] text-slate-400">{t("playbooksPage.createForm.timeoutSec")}</label>
									<input
										type="number"
										min={1}
										max={3600}
										value={step.timeoutSec}
										onChange={(e) => updateStep(step.id, { timeoutSec: Number(e.target.value) })}
										className={fieldInputClass}
									/>
								</div>
							</div>
						</div>
					))}
				</div>
			</div>

			<label className="flex items-center gap-2 text-sm text-slate-300">
				<input
					type="checkbox"
					checked={enabled}
					onChange={(e) => setEnabled(e.target.checked)}
					className="accent-cyan-400"
				/>
				{t("playbooksPage.createForm.enabled")}
			</label>

			<div className="flex gap-3 pt-2">
				<button
					type="submit"
					disabled={submitting}
					className="min-h-11 rounded-2xl bg-cyan-500 px-5 py-2 text-sm font-medium text-slate-950 transition hover:bg-cyan-400 disabled:opacity-60"
				>
					{submitting ? t("playbooksPage.createForm.submitting") : t("playbooksPage.createForm.submit")}
				</button>
				<button
					type="button"
					onClick={onClose}
					className="min-h-11 rounded-2xl border border-[var(--border)] px-5 py-2 text-sm text-slate-300 hover:bg-white/10 transition"
				>
					{t("playbooksPage.createForm.cancel")}
				</button>
			</div>
		</form>
	);
}

function StepConfigEditor({
	step,
	onConfigChange,
}: {
	step: SerializedStep;
	onConfigChange: (patch: Record<string, unknown>) => void;
}) {
	const { t } = useI18n();
	const cfg = step.config;
	if (step.type === "run_command") {
		return (
			<div className="space-y-1.5">
				<label className="text-[11px] text-slate-400">command</label>
				<textarea
					value={String(cfg.command ?? "")}
					onChange={(e) => onConfigChange({ command: e.target.value })}
					rows={2}
					placeholder="docker compose up -d"
					className={`${monoFieldInputClass} resize-y`}
				/>
				<p className="text-[10px] text-slate-500">{t("playbooksPage.createForm.runCommandHint")}</p>
			</div>
		);
	}
	if (step.type === "send_notification") {
		return (
			<div className="space-y-1.5">
				<label className="text-[11px] text-slate-400">recipientUserId</label>
				<input
					value={String(cfg.recipientUserId ?? "")}
					onChange={(e) => onConfigChange({ recipientUserId: e.target.value })}
					className={fieldInputClass}
				/>
				<label className="text-[11px] text-slate-400">subject</label>
				<input
					value={String(cfg.subject ?? "")}
					onChange={(e) => onConfigChange({ subject: e.target.value })}
					className={fieldInputClass}
				/>
				<label className="text-[11px] text-slate-400">body</label>
				<textarea
					value={String(cfg.body ?? "")}
					onChange={(e) => onConfigChange({ body: e.target.value })}
					rows={2}
					className={`${fieldInputClass} resize-y`}
				/>
			</div>
		);
	}
	return (
		<div className="space-y-1.5">
			<label className="text-[11px] text-slate-400">url</label>
			<input
				value={String(cfg.url ?? "")}
				onChange={(e) => onConfigChange({ url: e.target.value })}
				placeholder="https://example.com/hook"
				className={fieldInputClass}
			/>
			<label className="text-[11px] text-slate-400">method</label>
			<select
				value={String(cfg.method ?? "POST")}
				onChange={(e) => onConfigChange({ method: e.target.value })}
				className={fieldInputClass}
			>
				{(["GET", "POST", "PUT"] as const).map((m) => (
					<option key={m} value={m}>
						{m}
					</option>
				))}
			</select>
			<label className="text-[11px] text-slate-400">body (JSON, optional)</label>
			<textarea
				value={String(cfg.body ?? "")}
				onChange={(e) => onConfigChange({ body: e.target.value })}
				rows={2}
				className={`${monoFieldInputClass} resize-y`}
			/>
		</div>
	);
}
