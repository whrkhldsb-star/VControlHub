"use client";

import { useEffect, useRef, useState } from "react";
import { ActionButton } from "@/components/action-button";
import { Notice } from "@/components/ui-primitives";
import { Card, CountBadge, EmptyState, PageHeader, Section } from "@/components/page-shell";
import { PageGuide } from "@/components/page-guide";
import { useI18n } from "@/lib/i18n/use-locale";

import { AlertIncidentsSection } from "./alert-incidents-section";
import { AlertRuleCard } from "./alert-rule-card";
import type { AlertRule, PlaybookOption, ServerOption } from "./alert-rule-types";
import { AlertRulesHeaderActions, TestResultPanel } from "./alert-rules-sections";
import { CreateRuleForm } from "./create-rule-form";
import { DeleteRuleDialog } from "./delete-rule-dialog";
import { useAlertRuleActions } from "./use-alert-rule-actions";
import { IconSiren } from "@/components/nav-icons";

type Props = {
	/** Page header; rendered here so the page's commands sit in its actions. */
	header?: { eyebrow?: string; title: string; description?: string };
	rules: AlertRule[];
	servers: ServerOption[];
	playbooks?: PlaybookOption[];
	canManage: boolean;
	canManageSettings?: boolean;
	canReadPlaybooks?: boolean;
	canReadHealth?: boolean;
};

export function AlertRuleListClient({
	header,
	rules: initialRules,
	servers,
	playbooks = [],
	canManage,
	canManageSettings = false,
	canReadPlaybooks = false,
	canReadHealth = false,
}: Props) {
	const { t } = useI18n();
	const [editingRule, setEditingRule] = useState<AlertRule | null>(null);
	const formPanelRef = useRef<HTMLDivElement>(null);
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
	const formOpen = showCreate || editingRule !== null;

	useEffect(() => {
		if (formOpen) formPanelRef.current?.scrollIntoView?.({ behavior: "smooth", block: "start" });
	}, [formOpen, editingRule]);

	const openCreate = (next: boolean) => {
		if (next) setEditingRule(null);
		setShowCreate(next);
	};

	const openEdit = (rule: AlertRule) => {
		setShowCreate(false);
		setEditingRule(rule);
	};

	return (
		<div className="flex flex-col gap-5">
			<DeleteRuleDialog
				rulePendingDelete={rulePendingDelete}
				busyAction={busyAction}
				error={actionError}
				setRulePendingDelete={setRulePendingDelete}
				deleteRule={deleteRule}
			/>

			{header ? (
				<PageHeader eyebrow={header.eyebrow} title={header.title} description={header.description} className="">
					<AlertRulesHeaderActions
						canManage={canManage}
						showCreate={formOpen}
						setShowCreate={openCreate}
						busyAction={busyAction}
						triggerNow={triggerNow}
					/>
				</PageHeader>
			) : null}
			<PageGuide
				title={t("alertRulesPage.guide.title")}
				summary={t("alertRulesPage.guide.summary")}
				steps={[
					t("alertRulesPage.guide.step1"),
					t("alertRulesPage.guide.step2"),
					t("alertRulesPage.guide.step3"),
				]}
				links={[
					...(canManageSettings ? [{ label: t("alertRulesPage.openNotificationSettings"), href: "/settings#smtp" }] : []),
					...(canReadPlaybooks ? [{ label: t("alertRulesPage.openPlaybooks"), href: "/playbooks" }] : []),
					...(canReadHealth ? [{ label: t("alertRulesPage.openVpsStatus"), href: "/vps-status" }] : []),
				]}
			/>

			{/* While the delete question is open its failure is shown there, not behind it. */}
			{actionError && !rulePendingDelete && <Notice tone="danger">{actionError}</Notice>}

			<TestResultPanel testResult={testResult} />

			{formOpen && (
				<div ref={formPanelRef} className="scroll-mt-24">
					<Card title={editingRule ? `${t("alertRulesPage.editForm.title")}: ${editingRule.name}` : t("alertRulesPage.createForm.title")} padding="lg">
						<CreateRuleForm
							key={editingRule?.id ?? "new"}
							servers={servers}
							playbooks={playbooks}
							initialRule={editingRule ?? undefined}
							onClose={() => {
								setShowCreate(false);
								setEditingRule(null);
								void refresh();
							}}
						/>
					</Card>
				</div>
			)}

			<AlertIncidentsSection
				incidents={incidents}
				incidentsLoading={incidentsLoading}
				busyAction={busyAction}
				loadIncidents={loadIncidents}
				ackIncident={ackIncident}
			/>

			{rules.length === 0 ? (
				formOpen ? null : (
					<EmptyState
						icon={<IconSiren />}
						variant="boxed"
						title={t("alertRulesPage.empty")}
						text={t("alertRulesPage.emptyHint")}
						action={canManage ? (
							<ActionButton
								variant="primary"
								onClick={() => void ensureDefaults()}
								loading={busyAction === "defaults"}
							>
								{busyAction === "defaults"
									? t("alertRulesPage.action.processing")
									: t("alertRulesPage.ensureDefaults")}
							</ActionButton>
						) : undefined}
					/>
				)
			) : (
				<Section title={<span className="inline-flex items-center gap-2">{t("alertRulesPage.rules.title")}<CountBadge>{rules.length}</CountBadge></span>}>
					{rules.map((rule) => (
						<AlertRuleCard
							key={rule.id}
							rule={rule}
							canManage={canManage}
							busyAction={busyAction}
							toggleRule={toggleRule}
							testRule={testRule}
							setRulePendingDelete={setRulePendingDelete}
							onEdit={canManage ? openEdit : undefined}
							editDisabled={formOpen}
						/>
					))}
				</Section>
			)}
		</div>
	);
}
