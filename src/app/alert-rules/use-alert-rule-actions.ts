"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { useToast } from "@/components/toast-provider";
import { csrfFetch } from "@/lib/auth/csrf-client";
import { useI18n } from "@/lib/i18n/use-locale";
import { getErrorMessage } from "@/lib/http/error-message";

import type { AlertIncident, AlertRule, TestDelivery } from "./alert-rule-types";

export function useAlertRuleActions({
	initialRules,
	canManage,
}: {
	initialRules: AlertRule[];
	canManage: boolean;
}) {
	const { t } = useI18n();
	const { addToast } = useToast();
	const [rules, setRules] = useState(initialRules);
	const [incidents, setIncidents] = useState<AlertIncident[]>([]);
	const [incidentsLoading, setIncidentsLoading] = useState(false);
	const [showCreate, setShowCreate] = useState(false);
	const [actionError, setActionError] = useState<string | null>(null);
	const [testResult, setTestResult] = useState<{
		ruleName: string;
		deliveries: TestDelivery[];
	} | null>(null);
	const [busyAction, setBusyAction] = useState<string | null>(null);
	const busyActionRef = useRef<string | null>(null);
	const [rulePendingDelete, setRulePendingDelete] = useState<AlertRule | null>(null);

	const beginBusy = useCallback((key: string) => {
		if (busyActionRef.current) return false;
		busyActionRef.current = key;
		setBusyAction(key);
		return true;
	}, []);

	const endBusy = useCallback(() => {
		busyActionRef.current = null;
		setBusyAction(null);
	}, []);

	const errorText = useCallback(
		(error: unknown, fallbackKey: string) =>
			getErrorMessage(error, t(fallbackKey)),
		[t],
	);

	const refresh = useCallback(async () => {
		const data = await csrfFetch("/api/alert-rules");
		setRules(data?.rules ?? []);
	}, []);

	const loadIncidents = useCallback(async () => {
		if (!canManage) return;
		setIncidentsLoading(true);
		try {
			const data = await csrfFetch("/api/alert-incidents");
			setIncidents((data?.incidents ?? []) as AlertIncident[]);
		} catch (error) {
			setActionError(getErrorMessage(error, t("alertRulesPage.error.loadIncidents")));
		} finally {
			setIncidentsLoading(false);
		}
	}, [canManage, t]);

	/* eslint-disable react-hooks/set-state-in-effect -- bootstrap open incidents panel */
	useEffect(() => {
		void loadIncidents();
	}, [loadIncidents]);
	/* eslint-enable react-hooks/set-state-in-effect */

	const ackIncident = useCallback(
		async (incidentId: string) => {
			if (!beginBusy(`ack:${incidentId}`)) return;
			try {
				await csrfFetch("/api/alert-incidents", {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ incidentId }),
				});
				addToast("success", t("alertRulesPage.incidents.acked"));
				await loadIncidents();
			} catch (error) {
				setActionError(getErrorMessage(error, t("alertRulesPage.error.ack")));
			} finally {
				endBusy();
			}
		},
		[addToast, beginBusy, endBusy, loadIncidents, t],
	);

	const toggleRule = useCallback(
		async (id: string) => {
			if (!beginBusy(`toggle:${id}`)) return;
			setActionError(null);
			setTestResult(null);
			try {
				await csrfFetch("/api/alert-rules", {
					method: "PATCH",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ toggleId: id }),
				});
				await refresh();
			} catch (error) {
				setActionError(errorText(error, "alertRulesPage.error.toggle"));
			} finally {
				endBusy();
			}
		},
		[beginBusy, endBusy, refresh, errorText],
	);

	const deleteRule = useCallback(
		async (id: string) => {
			if (!beginBusy(`delete:${id}`)) return;
			setActionError(null);
			setTestResult(null);
			try {
				await csrfFetch(`/api/alert-rules?id=${id}`, { method: "DELETE" });
				setRulePendingDelete(null);
				await refresh();
			} catch (error) {
				setActionError(errorText(error, "alertRulesPage.error.delete"));
			} finally {
				endBusy();
			}
		},
		[beginBusy, endBusy, refresh, errorText],
	);

	const triggerNow = useCallback(async () => {
		if (!beginBusy("trigger")) return;
		setActionError(null);
		setTestResult(null);
		try {
			await csrfFetch("/api/alert-rules", { method: "PUT" });
			addToast("success", t("alertRulesPage.toast.triggered"));
			await refresh();
		} catch (error) {
			setActionError(errorText(error, "alertRulesPage.error.trigger"));
		} finally {
			endBusy();
		}
	}, [addToast, beginBusy, endBusy, refresh, t, errorText]);

	const ensureDefaults = useCallback(async () => {
		if (!beginBusy("defaults")) return;
		setActionError(null);
		setTestResult(null);
		try {
			const data = await csrfFetch("/api/alert-rules", {
				method: "PATCH",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ ensureDefaults: true }),
			});
			if (Array.isArray(data?.rules)) {
				setRules(data.rules);
			} else {
				await refresh();
			}
			const created = Number(data?.created ?? 0);
			addToast(
				"success",
				created > 0
					? t("alertRulesPage.toast.defaultsCreated", { count: created })
					: t("alertRulesPage.toast.defaultsExists"),
			);
		} catch (error) {
			setActionError(errorText(error, "alertRulesPage.error.defaults"));
		} finally {
			endBusy();
		}
	}, [addToast, beginBusy, endBusy, refresh, t, errorText]);

	const testRule = useCallback(
		async (rule: AlertRule) => {
			if (!beginBusy(`test:${rule.id}`)) return;
			setActionError(null);
			setTestResult(null);
			try {
				const data = await csrfFetch("/api/alert-rules", {
					method: "PATCH",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ testId: rule.id }),
				});
				const deliveries = Array.isArray(data?.deliveries) ? data?.deliveries : [];
				setTestResult({ ruleName: rule.name, deliveries });
				const failed = deliveries.filter(
					(delivery: TestDelivery) => delivery.status === "failed",
				).length;
				addToast(
					failed > 0 ? "warning" : "success",
					failed > 0
						? t("alertRulesPage.toast.testPartial")
						: t("alertRulesPage.toast.testSucceeded"),
				);
			} catch (error) {
				setActionError(errorText(error, "alertRulesPage.error.test"));
			} finally {
				endBusy();
			}
		},
		[addToast, beginBusy, endBusy, t, errorText],
	);

	return {
		rules,
		setRules,
		incidents,
		incidentsLoading,
		showCreate,
		setShowCreate,
		actionError,
		setActionError,
		testResult,
		setTestResult,
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
	};
}
