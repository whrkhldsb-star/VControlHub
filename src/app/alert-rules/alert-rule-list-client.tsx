"use client";

import { ActionButton } from "@/components/action-button";
import { Notice } from "@/components/ui-primitives";
import { Card, EmptyState, Section } from "@/components/page-shell";
import { useI18n } from "@/lib/i18n/use-locale";

import { AlertIncidentsSection } from "./alert-incidents-section";
import { AlertRuleCard } from "./alert-rule-card";
import type { AlertRule, PlaybookOption, ServerOption } from "./alert-rule-types";
import { AlertRulesToolbar, TestResultPanel } from "./alert-rules-sections";
import { CreateRuleForm } from "./create-rule-form";
import { DeleteRuleDialog } from "./delete-rule-dialog";
import { useAlertRuleActions } from "./use-alert-rule-actions";
import { IconSiren } from "@/components/nav-icons";

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
		<div className="flex flex-col gap-5">
			<DeleteRuleDialog
				rulePendingDelete={rulePendingDelete}
				busyAction={busyAction}
				setRulePendingDelete={setRulePendingDelete}
				deleteRule={deleteRule}
			/>

			<AlertRulesToolbar
				canManage={canManage}
				showCreate={showCreate}
				setShowCreate={setShowCreate}
				busyAction={busyAction}
				triggerNow={triggerNow}
			/>

			{actionError && <Notice tone="danger">{actionError}</Notice>}

			<TestResultPanel testResult={testResult} />

			{showCreate && (
				<Card title={t("alertRulesPage.createForm.title")} padding="lg">
					<CreateRuleForm
						servers={servers}
						playbooks={playbooks}
						onClose={() => {
							setShowCreate(false);
							void refresh();
						}}
					/>
				</Card>
			)}

			<AlertIncidentsSection
				incidents={incidents}
				incidentsLoading={incidentsLoading}
				busyAction={busyAction}
				loadIncidents={loadIncidents}
				ackIncident={ackIncident}
			/>

			{rules.length === 0 ? (
				<EmptyState icon={<IconSiren />} variant="boxed">
					<div className="space-y-3">
						<p>{t("alertRulesPage.empty")}</p>
						<p className="text-xs text-[var(--text-muted)]">{t("alertRulesPage.emptyHint")}</p>
						{canManage ? (
							<div className="flex flex-wrap justify-center gap-2">
								<ActionButton
									variant="primary"
									onClick={() => void ensureDefaults()}
									loading={busyAction === "defaults"}
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
				<Section title={<>{t("alertRulesPage.rules.title")} <span className="ml-1 text-[13px] font-normal text-[var(--text-muted)] tabular-nums">{rules.length}</span></>}>
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
				</Section>
			)}
		</div>
	);
}
