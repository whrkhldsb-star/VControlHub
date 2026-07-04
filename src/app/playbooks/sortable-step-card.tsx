"use client";

import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useI18n } from "@/lib/i18n/use-locale";
import { fieldInputClass, stepTypeLabel, defaultConfigFor } from "./playbook-types";
import type { SerializedStep, StepType } from "./playbook-types";
import { StepConfigEditor } from "./step-config-editor";

export function SortableStepCard({
	step,
	index,
	stepCount,
	onRemove,
	onUpdate,
	onConfigChange,
}: {
	step: SerializedStep;
	index: number;
	stepCount: number;
	onRemove: (id: string) => void;
	onUpdate: (id: string, patch: Partial<SerializedStep>) => void;
	onConfigChange: (id: string, patch: Record<string, unknown>) => void;
}) {
	const { t } = useI18n();
	const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: step.id });
	const style = {
		transform: CSS.Transform.toString(transform),
		transition,
	};

	return (
		<div
			ref={setNodeRef}
			style={style}
			data-card
			data-testid={`playbook-step-${step.id}`}
			className={`p-3 space-y-2 ${isDragging ? "relative z-10 opacity-80 ring-2 ring-[var(--color-action-ring)]" : ""}`}
		>
			<div className="flex items-center gap-2">
				<button
					type="button"
					className="min-h-9 cursor-grab rounded-lg border border-[var(--border)] px-2 py-1 text-xs text-[var(--text-secondary)] transition hover:bg-[var(--surface-elevated)] active:cursor-grabbing"
					aria-label={t("playbooksPage.createForm.dragHandleAria").replace("{index}", String(index + 1))}
					{...attributes}
					{...listeners}
				>
					☰ #{index + 1}
				</button>
				<input
					aria-label={t("playbooksPage.createForm.stepName")}
					value={step.name}
					onChange={(e) => onUpdate(step.id, { name: e.target.value })}
					placeholder={t("playbooksPage.createForm.stepNamePlaceholder")}
					className={`${fieldInputClass} flex-1`}
					required
				/>
				<select
					aria-label="step type"
					value={step.type}
					onChange={(e) => {
						const newType = e.target.value as StepType;
						onUpdate(step.id, { type: newType, config: defaultConfigFor(newType) });
					}}
					className={fieldInputClass}
				>
					{(["run_command", "send_notification", "call_webhook"] as StepType[]).map((tp) => (
						<option key={tp} value={tp}>
							{stepTypeLabel(t, tp)}
						</option>
					))}
				</select>
				{stepCount > 1 && (
					<button
						type="button"
						onClick={() => onRemove(step.id)}
						aria-label={t("playbooksPage.action.delete")}
						data-tone="danger"
						className="min-h-9 rounded-lg border px-2 py-1 text-xs"
					>
						×
					</button>
				)}
			</div>
			<StepConfigEditor step={step} onConfigChange={(p) => onConfigChange(step.id, p)} />
			<div className="grid gap-2 md:grid-cols-2">
				<div className="space-y-1">
					<label className="text-[11px] text-[var(--text-secondary)]">{t("playbooksPage.createForm.retry")}</label>
					<input
						type="number"
						min={0}
						max={5}
						value={step.retry}
						onChange={(e) => onUpdate(step.id, { retry: Number(e.target.value) })}
						className={fieldInputClass}
					/>
				</div>
				<div className="space-y-1">
					<label className="text-[11px] text-[var(--text-secondary)]">{t("playbooksPage.createForm.timeoutSec")}</label>
					<input
						type="number"
						min={1}
						max={3600}
						value={step.timeoutSec}
						onChange={(e) => onUpdate(step.id, { timeoutSec: Number(e.target.value) })}
						className={fieldInputClass}
					/>
				</div>
			</div>
		</div>
	);
}
