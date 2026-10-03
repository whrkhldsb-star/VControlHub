"use client";

import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useI18n } from "@/lib/i18n/use-locale";
import { fieldInputClass, stepTypeLabel, defaultConfigFor } from "./playbook-types";
import type { SerializedStep, StepType, ServerOption } from "./playbook-types";
import { StepConfigEditor } from "./step-config-editor";
import { ActionButton } from "@/components/action-button";

export function SortableStepCard({
	step,
	index,
	stepCount,
	servers,
	onRemove,
	onUpdate,
	onConfigChange,
}: {
	step: SerializedStep;
	index: number;
	stepCount: number;
	servers: ServerOption[];
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
				<ActionButton size="sm" variant="secondary"
					aria-label={t("playbooksPage.createForm.dragHandleAria", { index: index + 1 })}
					{...attributes}
					{...listeners} className="cursor-grab">
					<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="9" cy="5" r="1.6" /><circle cx="15" cy="5" r="1.6" /><circle cx="9" cy="12" r="1.6" /><circle cx="15" cy="12" r="1.6" /><circle cx="9" cy="19" r="1.6" /><circle cx="15" cy="19" r="1.6" /></svg>
					#{index + 1}
				</ActionButton>
				<input
					aria-label={t("playbooksPage.createForm.stepName")}
					value={step.name}
					onChange={(e) => onUpdate(step.id, { name: e.target.value })}
					placeholder={t("playbooksPage.createForm.stepNamePlaceholder")}
					className={`${fieldInputClass} flex-1`}
					required
				/>
				<select
					aria-label={t("playbooksPage.step.typeAria")}
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
					<ActionButton size="sm"
						variant="danger"
						onClick={() => onRemove(step.id)}
						aria-label={t("playbooksPage.action.delete")}>
						×
					</ActionButton>
				)}
			</div>
			<StepConfigEditor step={step} servers={servers} onConfigChange={(p) => onConfigChange(step.id, p)} />
			<div className="grid gap-2 md:grid-cols-2">
				<div className="space-y-1">
					<label className="ui-label">{t("playbooksPage.createForm.retry")}</label>
					<input
						type="number"
						min={0}
						max={5}
						value={step.retry}
						aria-label={t("playbooksPage.createForm.retry")}
						onChange={(e) => onUpdate(step.id, { retry: Number(e.target.value) })}
						className={fieldInputClass}
					/>
				</div>
				<div className="space-y-1">
					<label className="ui-label">{t("playbooksPage.createForm.timeoutSec")}</label>
					<input
						type="number"
						min={1}
						max={3600}
						value={step.timeoutSec}
						aria-label={t("playbooksPage.createForm.timeoutSec")}
						onChange={(e) => onUpdate(step.id, { timeoutSec: Number(e.target.value) })}
						className={fieldInputClass}
					/>
				</div>
			</div>
		</div>
	);
}
