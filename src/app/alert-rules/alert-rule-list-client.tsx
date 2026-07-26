"use client";

import { ActionButton } from "@/components/action-button";
import { EmptyState, SurfacePanel } from "@/components/page-shell";
import { useI18n } from "@/lib/i18n/use-locale";

import { AlertIncidentsSection } from "./alert-incidents-section";
import { AlertRuleCard } from "./alert-rule-card";
import type { AlertRule, PlaybookOption, ServerOption } from "./alert-rule-types";
import { AlertRulesToolbar, TestResultPanel } from "./alert-rules-sections";
import { CreateRuleForm } from "./create-rule-form";
import { DeleteRuleDialog } from "./delete-rule-dialog";
import { useAlertRuleActions } from "./use-alert-rule-actions";

type Props = {
	rules: AlertRule[];
	servers: ServerOption[];
	playbooks?: PlaybookOption[];
	canManage: boolean;
};

export function AlertRuleListClient({
	rules: initialRules,
	servers,
	playbooks = [],
	canManage,
}: Props) {
	const { t } = useI18n();
	const {
		rules,
		incidents,
		incidentsLoading,
		showCreate,
		setShowCreate,
		actionError,
		testResult,
		busyAction,
		rulePendingDelete,
		setRulePendingDelete,
		refresh,
		loadIncidents,
		ackIncident,
		toggleRule,
		deleteRule,
		triggerNow,
		ensureDefaults,
		testRule,
	} = useAlertRuleActions({ initialRules, canManage });

	return (
		<div className="space-y-6">
			<DeleteRuleDialog
				rulePendingDelete={rulePendingDelete}
				busyAction={busyAction}
				setRulePendingDelete={setRulePendingDelete}
				deleteRule={deleteRule}
			/>

			<AlertIncidentsSection
				incidents={incidents}
				incidentsLoading={incidentsLoading}
				busyAction={busyAction}
				loadIncidents={loadIncidents}
				ackIncident={ackIncident}
			/>
			<AlertRulesToolbar
				canManage={canManage}
				rulesEmpty={rules.length === 0}
				showCreate={showCreate}
				setShowCreate={setShowCreate}
				busyAction={busyAction}
				ensureDefaults={ensureDefaults}
				triggerNow={triggerNow}
			/>

			{actionError && (
				<div
					role="alert"
					data-tone="rose"
					className="rounded-xl border border-[var(--danger-border)] px-4 py-3 text-sm text-[var(--danger)]"
				>
					{actionError}
				</div>
			)}

			<TestResultPanel testResult={testResult} />

			{showCreate && (
				<div className="mb-1">
					<SurfacePanel title={t("alertRulesPage.create")}>
						<CreateRuleForm
							servers={servers}
							playbooks={playbooks}
							onClose={() => {
								setShowCreate(false);
								void refresh();
							}}
						/>
					</SurfacePanel>
				</div>
			)}

			{rules.length === 0 ? (
				<EmptyState icon="🔔" variant="boxed">
					<div className="space-y-3">
						<p>{t("alertRulesPage.empty")}</p>
						<p className="text-xs text-[var(--text-muted)]">{t("alertRulesPage.emptyHint")}</p>
						{canManage ? (
							<div className="flex flex-wrap justify-center gap-2">
								<ActionButton
									type="button"
									variant="primary"
									onClick={() => void ensureDefaults()}
									disabled={busyAction === "defaults"}
								>
									{busyAction === "defaults"
										? t("alertRulesPage.action.processing")
										: t("alertRulesPage.ensureDefaults")}
								</ActionButton>
							</div>
						) : null}
					</div>
				</EmptyState>
			) : (
				<div className="space-y-3">
					{rules.map((rule) => (
						<AlertRuleCard
							key={rule.id}
							rule={rule}
							canManage={canManage}
							busyAction={busyAction}
							toggleRule={toggleRule}
							testRule={testRule}
							setRulePendingDelete={setRulePendingDelete}
						/>
					))}
				</div>
			)}
		</div>
	);
}
