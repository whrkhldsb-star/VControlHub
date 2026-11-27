"use client";

/**
 * Active customer, at the top of the sidebar so it is always visible.
 *
 * Platform administrators pick one customer, or "all customers", and every
 * list follows that choice. A customer account always works inside its own
 * customer, so it only sees the name.
 */
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import { csrfFetch } from "@/lib/auth/csrf-client";
import { useGateRoute } from "@/lib/auth/use-gate-route";
import { useI18n } from "@/lib/i18n/use-locale";
import { getErrorMessage } from "@/lib/http/error-message";
import { CUSTOMERS_CHANGED_EVENT } from "@/lib/team/customers-changed";
import {
	beginScopeSwitchRelease,
	endScopeSwitchRelease,
	finishScopeSwitchRelease,
	formatActiveWorkSummary,
	getActiveWorkSnapshot,
} from "@/lib/forms/active-work-guard";
import { toggleSidebarCollapsed } from "@/lib/ui/shell-preferences";
import { UI_INPUT } from "@/lib/ui/classes";
import { cn } from "@/lib/ui/cn";
import { useToast } from "./toast-provider";
import { Globe, Loader2 } from "./icons";
import { ActionButton } from "./action-button";
import { ConfirmDialog } from "./confirm-dialog";

type CustomerItem = { id: string; name: string };

/** Value of the "all customers" option; the API takes `null`. */
const ALL_CUSTOMERS = "";

export function CustomerSwitcher({ compact = false }: { compact?: boolean } = {}) {
	const gate = useGateRoute();
	const { t } = useI18n();
	const { addToast } = useToast();
	const router = useRouter();
	const [customers, setCustomers] = useState<CustomerItem[] | null>(null);
	const [currentTeamId, setCurrentTeamId] = useState<string | null>(null);
	const [switching, setSwitching] = useState(false);
	const [pendingSwitch, setPendingSwitch] = useState<{
		teamId: string | null;
		label: string;
		summary: string;
	} | null>(null);
	const [switchDialogError, setSwitchDialogError] = useState<string | null>(null);
	// A failed refresh keeps the last list the server confirmed: an empty list
	// would claim there are no customers at all.
	const [loadError, setLoadError] = useState<string | null>(null);
	const [retrying, setRetrying] = useState(false);
	const canList = gate.can("team:read");
	const isAdmin = gate.can("team:manage");

	const load = useCallback(async () => {
		try {
			const data = await csrfFetch<{ teams: CustomerItem[]; currentTeamId: string | null }>("/api/teams");
			setCustomers(data.teams ?? []);
			setCurrentTeamId(data.currentTeamId ?? null);
			setLoadError(null);
		} catch (err) {
			setLoadError(getErrorMessage(err, t("nav.customerLoadFailed")));
		}
	}, [t]);

	async function retry() {
		setRetrying(true);
		try {
			await load();
		} finally {
			setRetrying(false);
		}
	}

	useEffect(() => {
		if (!canList) return;
		// Request lifecycle owns this state; setState lands in the async callbacks.
		// eslint-disable-next-line react-hooks/set-state-in-effect
		void load();
		const reload = () => void load();
		window.addEventListener(CUSTOMERS_CHANGED_EVENT, reload);
		return () => window.removeEventListener(CUSTOMERS_CHANGED_EVENT, reload);
	}, [canList, load]);

	async function performSwitch(teamId: string | null, fromDialog: boolean) {
		if (teamId === currentTeamId || switching) return;
		setSwitching(true);
		setSwitchDialogError(null);
		beginScopeSwitchRelease();
		try {
			await csrfFetch("/api/teams/switch", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ teamId }),
			});
			setCurrentTeamId(teamId);
			setPendingSwitch(null);
			finishScopeSwitchRelease();
			// Customer-scoped server components read the selection per request.
			router.refresh();
		} catch (err) {
			endScopeSwitchRelease();
			const message = getErrorMessage(err, t("nav.customerSwitchFailed"));
			if (fromDialog) setSwitchDialogError(message);
			else addToast("error", message);
		} finally {
			setSwitching(false);
		}
	}

	function handleSwitch(value: string) {
		const teamId = value === ALL_CUSTOMERS ? null : value;
		if (teamId === currentTeamId || switching) return;
		const snapshot = getActiveWorkSnapshot();
		if (snapshot.hasAny) {
			const label = teamId
				? (customers?.find((customer) => customer.id === teamId)?.name ?? t("nav.customerLabel"))
				: t("nav.allCustomers");
			setSwitchDialogError(null);
			setPendingSwitch({
				teamId,
				label,
				summary: formatActiveWorkSummary(snapshot, t),
			});
			return;
		}
		void performSwitch(teamId, false);
	}

	if (!canList) return null;
	if (compact) {
		if (!customers) return null;
		const activeName = isAdmin
			? (currentTeamId
				? (customers.find((customer) => customer.id === currentTeamId)?.name ?? t("nav.customerLabel"))
				: t("nav.allCustomers"))
			: (customers[0]?.name ?? null);
		if (!activeName) return null;
		const initial = activeName.trim().slice(0, 1);
		const compactLabel = t("nav.customerCompactTitle", { name: activeName });
		if (!isAdmin) {
			return (
				<div className="flex justify-center px-1.5 pb-2">
					<span
						data-tile=""
						title={compactLabel}
						aria-label={compactLabel}
						className="flex h-8 w-8 items-center justify-center text-xs font-semibold text-[var(--text-primary)]"
					>
						{initial}
					</span>
				</div>
			);
		}
		return (
			<div className="flex justify-center px-1.5 pb-2">
				<button
					type="button"
					data-tile=""
					onClick={toggleSidebarCollapsed}
					title={compactLabel}
					aria-label={compactLabel}
					className="flex h-8 w-8 cursor-pointer items-center justify-center text-xs font-semibold text-[var(--text-primary)] transition hover:bg-[var(--surface-hover)]"
				>
					{currentTeamId ? initial : <Globe size={15} aria-hidden="true" />}
				</button>
			</div>
		);
	}
	const errorRow = loadError ? (
		<div role="alert" className="flex min-w-0 items-center gap-1.5 px-2.5 pb-2 text-[11px] leading-4 text-[var(--danger)]">
			<span className="min-w-0 flex-1 truncate" title={loadError}>{t("nav.customerLoadFailed")}</span>
			<ActionButton size="xs" variant="ghost" loading={retrying} onClick={() => void retry()}>
				{t("common.retry")}
			</ActionButton>
		</div>
	) : null;
	if (customers === null && errorRow) return errorRow;
	if (customers === null) {
		return (
			<div className="flex items-center px-2.5 py-2 text-xs text-[var(--text-muted)]" aria-hidden="true">
				<Loader2 size={14} className="animate-spin" />
			</div>
		);
	}

	if (!isAdmin) {
		const own = customers[0];
		return (
			<>
				{own ? (
					<div className="px-2.5 pb-2">
						<span className="block text-[11px] text-[var(--text-muted)]">{t("nav.customerLabel")}</span>
						<span className="block truncate text-[13px] font-medium text-[var(--text-primary)]" title={own.name}>{own.name}</span>
					</div>
				) : null}
				{errorRow}
			</>
		);
	}

	return (
		<>
			<div className="px-2.5 pb-2">
				<label className="block">
					<span className="mb-1 block text-[11px] text-[var(--text-muted)]">{t("nav.customerLabel")}</span>
					<span className="relative flex min-w-0 items-center">
						<select
							value={currentTeamId ?? ALL_CUSTOMERS}
							disabled={switching}
							aria-label={t("nav.customerLabel")}
							onChange={(event) => handleSwitch(event.target.value)}
							className={cn(UI_INPUT, "h-8 cursor-pointer truncate py-1 pl-2.5 text-[13px] disabled:opacity-60")}
						>
							<option value={ALL_CUSTOMERS}>{t("nav.allCustomers")}</option>
							{customers.map((customer) => <option key={customer.id} value={customer.id}>{customer.name}</option>)}
						</select>
						{switching ? <Loader2 size={12} className="absolute right-7 animate-spin text-[var(--text-muted)]" aria-hidden /> : null}
					</span>
				</label>
			</div>
			{errorRow}
			<ConfirmDialog
				open={pendingSwitch !== null}
				title={t("nav.customerSwitchConfirmTitle", { name: pendingSwitch?.label ?? "" })}
				description={pendingSwitch ? t("nav.customerSwitchConfirmDesc", { name: pendingSwitch.label, items: pendingSwitch.summary }) : undefined}
				cancelLabel={t("common.cancel")}
				confirmLabel={t("nav.customerSwitchConfirmButton")}
				busy={switching}
				error={switchDialogError}
				closeOnBackdrop={false}
				onCancel={() => {
					if (switching) return;
					setPendingSwitch(null);
					setSwitchDialogError(null);
				}}
				onConfirm={() => {
					if (!pendingSwitch) return;
					void performSwitch(pendingSwitch.teamId, true);
				}}
			/>
		</>
	);
}
