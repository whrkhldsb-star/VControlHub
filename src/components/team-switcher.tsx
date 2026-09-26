"use client";

/**
 * Sidebar team-workspace switcher.
 *
 * Tickets, commands and file scopes are team-isolated (`teamWhere()`), but
 * the only switch affordance used to live three levels deep in Settings →
 * 团队空间. This renders a compact select in the sidebar account block,
 * gated on `team:read` (the same permission the teams API enforces) and
 * hidden entirely for users with no workspace memberships.
 */
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import { csrfFetch } from "@/lib/auth/csrf-client";
import { useGateRoute } from "@/lib/auth/use-gate-route";
import { useI18n } from "@/lib/i18n/use-locale";
import { getErrorMessage } from "@/lib/http/error-message";
import { useToast } from "./toast-provider";
import { Loader2 } from "./icons";

type TeamItem = {
	id: string;
	name: string;
	slug: string;
};

export function TeamSwitcher() {
	const gate = useGateRoute();
	const { t } = useI18n();
	const { addToast } = useToast();
	const router = useRouter();

	const [teams, setTeams] = useState<TeamItem[] | null>(null);
	const [currentTeamId, setCurrentTeamId] = useState<string | null>(null);
	const [switching, setSwitching] = useState(false);

	const canList = gate.can("team:read");

	const loadTeams = useCallback(async () => {
		try {
			const data = await csrfFetch<{ teams: TeamItem[]; currentTeamId: string | null }>("/api/teams");
			setTeams(data.teams ?? []);
			setCurrentTeamId(data.currentTeamId ?? null);
		} catch {
			// No permission or a transient failure: the switcher simply stays hidden.
			setTeams([]);
		}
	}, []);

	useEffect(() => {
		if (!canList) return;
		// Request lifecycle owns the teams state; setState lands in the async
		// callbacks, not synchronously during the effect.
		// eslint-disable-next-line react-hooks/set-state-in-effect
		void loadTeams();
	}, [canList, loadTeams]);

	async function handleSwitch(teamId: string) {
		if (!teamId || teamId === currentTeamId || switching) return;
		setSwitching(true);
		try {
			await csrfFetch("/api/teams/switch", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ teamId }),
			});
			setCurrentTeamId(teamId);
			addToast("success", t("nav.teamSwitchSuccess"));
			// Team-scoped server components read currentTeamId per request, so a
			// refresh is all the switch needs to take effect everywhere.
			router.refresh();
		} catch (err) {
			addToast("error", getErrorMessage(err, t("nav.teamSwitchFailed")));
		} finally {
			setSwitching(false);
		}
	}

	if (!canList) return null;
	if (teams === null) {
		return (
			<div className="flex items-center gap-2 px-2.5 py-2 text-xs text-[var(--text-muted)]" aria-hidden="true">
				<Loader2 size={14} className="animate-spin" />
			</div>
		);
	}
	if (teams.length === 0) return null;

	return (
		<div className="px-2.5 py-1">
			<label className="flex min-w-0 items-center gap-2 rounded-lg px-1 py-1.5 text-xs text-[var(--text-muted)]">
				<span className="shrink-0 font-medium">{t("nav.teamSwitchLabel")}</span>
				<span className="relative inline-flex min-w-0 flex-1 items-center">
					<select
						value={currentTeamId ?? ""}
						disabled={switching}
						aria-label={t("nav.teamSwitchLabel")}
						onChange={(event) => void handleSwitch(event.target.value)}
						className="min-h-8 w-full min-w-0 cursor-pointer truncate rounded-md border border-[var(--border-subtle)] bg-[var(--surface-subtle)] py-1 pl-2 pr-6 text-xs text-[var(--text-primary)] outline-none transition focus:border-[var(--input-border-focus)] disabled:opacity-60"
					>
						{teams.map((team) => (
							<option key={team.id} value={team.id}>
								{team.name}
								{team.id === currentTeamId ? ` · ${t("nav.teamCurrent")}` : ""}
							</option>
						))}
					</select>
					{switching ? (
						<Loader2 size={12} className="absolute right-2 animate-spin text-[var(--text-muted)]" aria-hidden />
					) : null}
				</span>
			</label>
		</div>
	);
}
