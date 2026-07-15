"use client";

import { useState } from "react";
import {
	DndContext,
	KeyboardSensor,
	PointerSensor,
	closestCenter,
	type DragEndEvent,
	useSensor,
	useSensors,
} from "@dnd-kit/core";
import {
	SortableContext,
	sortableKeyboardCoordinates,
	verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { csrfFetch } from "@/lib/auth/csrf-client";
import { useI18n } from "@/lib/i18n/use-locale";
import { useToast } from "@/components/toast-provider";
import { fieldLabelClass, fieldInputClass, monoFieldInputClass, makeNewStep, reorderSteps } from "./playbook-types";
import type { TriggerType, SerializedStep } from "./playbook-types";
import { SortableStepCard } from "./sortable-step-card";

export function CreatePlaybookForm({ onClose }: { onClose: () => void }) {
	const { t } = useI18n();
	const { addToast } = useToast();
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
	const sensors = useSensors(
		useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
		useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
	);
	const handleStepDragEnd = (event: DragEndEvent) => {
		const { active, over } = event;
		if (!over || active.id === over.id) return;
		setSteps((prev) => reorderSteps(prev, String(active.id), String(over.id)));
	};

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
			addToast("success", t("playbooksPage.toast.created"));
			onClose();
		} catch (err) {
			setError(err instanceof Error ? err.message : t("playbooksPage.createForm.error"));
		} finally {
			setSubmitting(false);
		}
	};

	return (
		<form onSubmit={handleSubmit} data-card className="space-y-4">
			<h3 className="text-lg font-semibold text-[var(--text-primary)]">{t("playbooksPage.createForm.title")}</h3>
			{error && (
				<div role="alert" className="rounded-lg bg-[var(--danger-bg)]/20 border border-[var(--danger-border)] px-3.5 py-2.5 text-sm text-[var(--danger)]">
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
									? "border-[var(--color-action-border)]/20 bg-[var(--color-action-bg)]/[0.10] text-[var(--text-primary)]"
									: "border-[var(--border)] bg-[var(--surface)] text-[var(--text-secondary)] hover:bg-[var(--surface-hover)]"
							}`}
						>
							<input
								type="radio"
								name="trigger-type"
								value={opt}
								checked={triggerType === opt}
								onChange={() => setTriggerType(opt)}
								className="accent-[var(--color-action)]"
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
						className="min-h-9 rounded-lg border px-3 py-1 text-xs transition"
					>
						{t("playbooksPage.createForm.addStep")}
					</button>
				</div>
				<DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleStepDragEnd}>
					<SortableContext items={steps.map((step) => step.id)} strategy={verticalListSortingStrategy}>
						<div className="space-y-2" aria-label={t("playbooksPage.createForm.stepsSortableRegion")}>
							{steps.map((step, idx) => (
								<SortableStepCard
									key={step.id}
									step={step}
									index={idx}
									stepCount={steps.length}
									onRemove={removeStep}
									onUpdate={updateStep}
									onConfigChange={updateStepConfig}
								/>
							))}
						</div>
					</SortableContext>
				</DndContext>
			</div>

			<label className="flex items-center gap-2 text-sm text-[var(--text-secondary)]">
				<input
					type="checkbox"
					checked={enabled}
					onChange={(e) => setEnabled(e.target.checked)}
					className="accent-[var(--color-action)]"
				/>
				{t("playbooksPage.createForm.enabled")}
			</label>

			<div className="flex gap-3 pt-2">
				<button
					type="submit"
					disabled={submitting}
					className="min-h-11 rounded-2xl bg-[var(--accent)] px-5 py-2 text-sm font-medium text-[var(--on-accent)] transition hover:bg-[var(--accent-hover)] disabled:opacity-60"
				>
					{submitting ? t("playbooksPage.createForm.submitting") : t("playbooksPage.createForm.submit")}
				</button>
				<button
					type="button"
					onClick={onClose}
					className="min-h-11 rounded-2xl border border-[var(--border)] px-5 py-2 text-sm text-[var(--text-secondary)] hover:bg-[var(--surface-hover)] transition"
				>
					{t("playbooksPage.createForm.cancel")}
				</button>
			</div>
		</form>
	);
}
