"use client";

import { useEffect, useState } from "react";
import { csrfFetch } from "@/lib/auth/csrf-client";
import { useI18n } from "@/lib/i18n/use-locale";

type TeamMemberDto = {
	role: string;
	joinedAt: string;
	user: { id: string; username: string; displayName: string | null; status: string };
};

type TeamDto = {
	id: string;
	slug: string;
	name: string;
	description: string | null;
	ownerId: string | null;
	createdAt: string;
	members: TeamMemberDto[];
};

type PendingConfirm =
	| { kind: "removeMember"; teamId: string; userId: string; name: string }
	| { kind: "deleteTeam"; teamId: string; name: string }
	| null;

function formatCopy(template: string, replacements: Record<string, string | number>) {
	return Object.entries(replacements).reduce((text, [key, value]) => text.replaceAll(`{${key}}`, String(value)), template);
}

export function TeamWorkspaceSection({ canManage }: { canManage: boolean }) {
	const { t } = useI18n();
	const [teams, setTeams] = useState<TeamDto[]>([]);
	const [currentTeamId, setCurrentTeamId] = useState<string | null>(null);
	const [name, setName] = useState("");
	const [slug, setSlug] = useState("");
	const [memberUsername, setMemberUsername] = useState("");
	const [memberRole, setMemberRole] = useState<"admin" | "member">("member");
	const [targetTeamId, setTargetTeamId] = useState("");
	const [loading, setLoading] = useState(true);
	const [busy, setBusy] = useState(false);
	const [message, setMessage] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [editingTeamId, setEditingTeamId] = useState<string | null>(null);
	const [editName, setEditName] = useState("");
	const [editDesc, setEditDesc] = useState("");
	const [pendingConfirm, setPendingConfirm] = useState<PendingConfirm>(null);

	async function refresh() {
		setLoading(true);
		try {
			const data = await csrfFetch<{ teams: TeamDto[]; currentTeamId: string | null }>("/api/teams");
			setTeams(data.teams ?? []);
			setCurrentTeamId(data.currentTeamId ?? null);
			setTargetTeamId((prev) => prev || data.teams?.[0]?.id || "");
		} catch (err) {
			setError(err instanceof Error ? err.message : t("settingsTeam.error.load"));
		} finally {
			setLoading(false);
		}
	}

	useEffect(() => {
		void refresh();
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);

	async function createTeam() {
		if (!name.trim()) return;
		setBusy(true);
		setError(null);
		setMessage(null);
		try {
			await csrfFetch("/api/teams", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ name, slug: slug.trim() || undefined }),
			});
			setName("");
			setSlug("");
			setMessage(t("settingsTeam.message.created"));
			await refresh();
		} catch (err) {
			setError(err instanceof Error ? err.message : t("settingsTeam.error.create"));
		} finally {
			setBusy(false);
		}
	}

	async function switchTeam(teamId: string) {
		setBusy(true);
		setError(null);
		setMessage(null);
		try {
			await csrfFetch("/api/teams/switch", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ teamId }),
			});
			setMessage(t("settingsTeam.message.switched"));
			setTimeout(() => window.location.reload(), 800);
		} catch (err) {
			setError(err instanceof Error ? err.message : t("settingsTeam.error.switch"));
		} finally {
			setBusy(false);
		}
	}

	async function addMember() {
		if (!targetTeamId || !memberUsername.trim()) return;
		setBusy(true);
		setError(null);
		setMessage(null);
		try {
			await csrfFetch(`/api/teams/${targetTeamId}/members`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ username: memberUsername, role: memberRole }),
			});
			setMemberUsername("");
			setMessage(t("settingsTeam.message.memberUpdated"));
			await refresh();
		} catch (err) {
			setError(err instanceof Error ? err.message : t("settingsTeam.error.addMember"));
		} finally {
			setBusy(false);
		}
	}

	function removeMember(teamId: string, userId: string, memberName: string) {
		setPendingConfirm({ kind: "removeMember", teamId, userId, name: memberName });
	}

	function startEditTeam(team: TeamDto) {
		setEditingTeamId(team.id);
		setEditName(team.name);
		setEditDesc(team.description ?? "");
	}

	async function saveEditTeam(teamId: string) {
		setBusy(true);
		setError(null);
		setMessage(null);
		try {
			await csrfFetch(`/api/teams/${teamId}`, {
				method: "PATCH",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ name: editName, description: editDesc || null }),
			});
			setEditingTeamId(null);
			setMessage(t("settingsTeam.message.updated"));
			await refresh();
		} catch (err) {
			setError(err instanceof Error ? err.message : t("settingsTeam.error.update"));
		} finally {
			setBusy(false);
		}
	}

	function deleteTeamSpace(teamId: string, teamName: string) {
		setPendingConfirm({ kind: "deleteTeam", teamId, name: teamName });
	}

	async function confirmPendingAction() {
		if (!pendingConfirm) return;
		setBusy(true);
		setError(null);
		setMessage(null);
		try {
			if (pendingConfirm.kind === "removeMember") {
				await csrfFetch(`/api/teams/${pendingConfirm.teamId}/members/${pendingConfirm.userId}`, { method: "DELETE" });
				setMessage(t("settingsTeam.message.memberRemoved"));
			} else {
				await csrfFetch(`/api/teams/${pendingConfirm.teamId}`, { method: "DELETE" });
				setMessage(t("settingsTeam.message.deleted"));
			}
			setPendingConfirm(null);
			await refresh();
		} catch (err) {
			setError(err instanceof Error ? err.message : t(pendingConfirm.kind === "removeMember" ? "settingsTeam.error.removeMember" : "settingsTeam.error.delete"));
		} finally {
			setBusy(false);
		}
	}

	const confirmTitle = pendingConfirm?.kind === "removeMember" ? t("settingsTeam.confirm.removeMember.title") : t("settingsTeam.confirm.deleteTeam.title");
	const confirmDesc = pendingConfirm
		? formatCopy(t(pendingConfirm.kind === "removeMember" ? "settingsTeam.confirm.removeMember.desc" : "settingsTeam.confirm.deleteTeam.desc"), { name: pendingConfirm.name })
		: "";

	return (
		<section id="team-workspaces" data-card className="rounded-xl border border-[var(--border)] bg-[var(--surface)] space-y-4 p-5">
			<div>
				<p className="text-xs font-semibold uppercase tracking-[0.3em] text-[var(--color-action)]/80">{t("settingsTeam.eyebrow")}</p>
				<h2 className="mt-1 text-xl font-semibold text-[var(--text-primary)]">{t("settingsTeam.title")}</h2>
				<p className="mt-1 text-sm text-[var(--text-secondary)]">{t("settingsTeam.desc")}</p>
			</div>

			{error && <div role="alert" className="rounded-xl border border-[var(--danger-border)] bg-[var(--danger-bg)] px-3 py-2 text-sm text-[var(--danger)] light:text-[var(--danger)]">{error}</div>}
			{message && <div className="rounded-xl border border-[var(--success-border)] bg-[var(--success-bg)] px-3 py-2 text-sm text-[var(--success)] light:text-[var(--success)]">{message}</div>}

			{loading ? (
				<p className="text-sm text-[var(--text-muted)]">{t("settingsTeam.loading")}</p>
			) : teams.length === 0 ? (
				<p className="text-sm text-[var(--text-muted)]">{t("settingsTeam.empty")}</p>
			) : (
				<div className="grid gap-3 md:grid-cols-2">
					{teams.map((team) => (
						<article key={team.id} className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--surface-subtle)] p-4">
							<div className="flex items-start justify-between gap-3">
								<div className="flex-1">
									{editingTeamId === team.id ? (
										<div className="space-y-1">
											<input value={editName} aria-label={t("settingsTeam.namePlaceholder")} onChange={(e) => setEditName(e.target.value)} className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2 py-1 text-sm" />
											<input value={editDesc} aria-label={t("settingsTeam.descriptionPlaceholder")} onChange={(e) => setEditDesc(e.target.value)} placeholder={t("settingsTeam.descriptionPlaceholder")} className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2 py-1 text-xs" />
										</div>
									) : (
										<>
											<h3 className="font-semibold text-[var(--text-primary)]">{team.name}</h3>
											<p className="text-xs text-[var(--text-muted)]">/{team.slug} · {formatCopy(t("settingsTeam.memberCount"), { count: team.members.length })}</p>
											{team.description && <p className="mt-1 text-xs text-[var(--text-secondary)]">{team.description}</p>}
										</>
									)}
								</div>
								<div className="flex flex-col gap-1">
									<button type="button" disabled={busy || currentTeamId === team.id} onClick={() => switchTeam(team.id)} className="min-h-9 rounded-xl border border-[var(--border)] px-3 py-1 text-xs text-[var(--text-secondary)] disabled:opacity-60">
										{currentTeamId === team.id ? t("settingsTeam.current") : t("settingsTeam.switch")}
									</button>
									{canManage && editingTeamId !== team.id && (
										<button type="button" disabled={busy} onClick={() => startEditTeam(team)} className="min-h-9 rounded-xl border border-[var(--border)] px-3 py-1 text-xs text-[var(--text-secondary)] disabled:opacity-60">
											{t("settingsTeam.edit")}
										</button>
									)}
									{canManage && editingTeamId === team.id && (
										<button type="button" disabled={busy} onClick={() => saveEditTeam(team.id)} className="min-h-9 rounded-xl border border-[var(--border)] px-3 py-1 text-xs text-[var(--success)] light:text-[var(--success)] disabled:opacity-60">
											{t("settingsTeam.save")}
										</button>
									)}
									{canManage && (
										<button type="button" disabled={busy} onClick={() => deleteTeamSpace(team.id, team.name)} className="min-h-9 rounded-xl border border-[var(--danger-border)] px-3 py-1 text-xs text-[var(--danger)] light:text-[var(--danger)] disabled:opacity-60">
											{t("settingsTeam.delete")}
										</button>
									)}
								</div>
							</div>
							<ul className="mt-3 space-y-1 text-xs text-[var(--text-secondary)]">
								{team.members.slice(0, 10).map((member) => (
									<li key={member.user.id} className="flex items-center justify-between gap-2">
										<span>{member.user.displayName || member.user.username}</span>
										<span className="flex items-center gap-2">
											<span className="text-[var(--text-muted)]">{member.role}</span>
											{canManage && member.role !== "owner" && (
												<button type="button" disabled={busy} onClick={() => removeMember(team.id, member.user.id, member.user.displayName || member.user.username)} className="text-[var(--danger)]/70 hover:text-[var(--danger)] light:text-[var(--danger)] light:hover:text-[var(--danger)] disabled:opacity-60">
													✕
												</button>
											)}
										</span>
									</li>
								))}
								{team.members.length > 10 && (
									<li className="text-[var(--text-muted)]">{formatCopy(t("settingsTeam.moreMembers"), { count: team.members.length - 10 })}</li>
								)}
							</ul>
						</article>
					))}
				</div>
			)}

			{canManage && (
				<div className="grid gap-4 border-t border-[var(--border-subtle)] pt-4 md:grid-cols-2">
					<div className="space-y-2">
						<h3 className="text-sm font-semibold text-[var(--text-primary)]">{t("settingsTeam.createTitle")}</h3>
						<input value={name} aria-label={t("settingsTeam.namePlaceholder")} onChange={(e) => setName(e.target.value)} placeholder={t("settingsTeam.namePlaceholder")} className="w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm" />
						<input value={slug} aria-label={t("settingsTeam.slugPlaceholder")} onChange={(e) => setSlug(e.target.value)} placeholder={t("settingsTeam.slugPlaceholder")} className="w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm" />
						<button type="button" disabled={busy || !name.trim()} onClick={createTeam} data-tone="accent" className="min-h-10 rounded-xl bg-[var(--accent)] text-[var(--color-action-fg)] px-4 py-2 text-sm font-medium disabled:opacity-60 hover:opacity-90 transition">{t("settingsTeam.createButton")}</button>
					</div>
					<div className="space-y-2">
						<h3 className="text-sm font-semibold text-[var(--text-primary)]">{t("settingsTeam.addMemberTitle")}</h3>
						<select value={targetTeamId} onChange={(e) => setTargetTeamId(e.target.value)} className="w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm">
							{teams.map((team) => <option key={team.id} value={team.id}>{team.name}</option>)}
						</select>
						<input value={memberUsername} aria-label={t("settingsTeam.usernamePlaceholder")} onChange={(e) => setMemberUsername(e.target.value)} placeholder={t("settingsTeam.usernamePlaceholder")} className="w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm" />
						<select value={memberRole} onChange={(e) => setMemberRole(e.target.value as "admin" | "member")} className="w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm">
							<option value="member">member</option>
							<option value="admin">admin</option>
						</select>
						<button type="button" disabled={busy || !targetTeamId || !memberUsername.trim()} onClick={addMember} data-tone="accent" className="min-h-10 rounded-xl bg-[var(--accent)] text-[var(--color-action-fg)] px-4 py-2 text-sm font-medium disabled:opacity-60 hover:opacity-90 transition">{t("settingsTeam.addMemberButton")}</button>
					</div>
				</div>
			)}

			{pendingConfirm ? (
				<div className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--surface)]/70 px-4 backdrop-blur-sm" role="presentation">
					<section role="dialog" aria-modal="true" aria-labelledby="team-workspace-confirm-title" className="w-full max-w-md rounded-2xl border border-[var(--danger-border)] bg-[var(--modal-bg)] p-6 shadow-[0_24px_100px_rgba(244,63,94,0.16)]">
						<h3 id="team-workspace-confirm-title" className="text-lg font-semibold text-[var(--text-primary)]">{confirmTitle}</h3>
						<p className="mt-3 text-sm leading-6 text-[var(--text-secondary)]">{confirmDesc}</p>
						<div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
							<button type="button" onClick={() => setPendingConfirm(null)} className="min-h-11 rounded-xl border border-[var(--border)] px-4 py-2 text-sm font-medium text-[var(--text-secondary)] hover:bg-[var(--surface-hover)]">{t("settingsTeam.confirm.cancel")}</button>
							<button type="button" onClick={() => void confirmPendingAction()} disabled={busy} className="min-h-11 rounded-xl bg-[var(--danger)] px-4 py-2 text-sm font-semibold text-[var(--text-primary)] hover:bg-[var(--danger-bg)] hover:text-[var(--danger)] disabled:opacity-60">{t("settingsTeam.confirm.submit")}</button>
						</div>
					</section>
				</div>
			) : null}
		</section>
	);
}
