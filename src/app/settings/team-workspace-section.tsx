"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { csrfFetch } from "@/lib/auth/csrf-client";
import { useI18n } from "@/lib/i18n/use-locale";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { getErrorMessage } from "@/lib/http/error-message";
import { ActionButton } from "@/components/action-button";
import { IconButton, Notice } from "@/components/ui-primitives";
import { UI_INPUT } from "@/lib/ui/classes";
import { X } from "@/components/icons";

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

/**
 * What the viewer may do with team workspaces. The team APIs authorize per
 * workspace (global `team:manage`, or owner/admin of that one team), so the UI
 * mirrors that instead of hiding everything behind the admin-only `user:manage`
 * flag that gates the rest of the settings page.
 */
export type TeamCapabilities = {
	viewerId: string;
	canCreate: boolean;
	canManageMembers: boolean;
	canManageAll: boolean;
};

export function TeamWorkspaceSection({ capabilities }: { capabilities: TeamCapabilities }) {
	const { viewerId, canCreate, canManageMembers, canManageAll } = capabilities;
	const { t } = useI18n();
	const router = useRouter();
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
	const [expandedTeamIds, setExpandedTeamIds] = useState<Set<string>>(new Set());

	function viewerRoleIn(team: TeamDto) {
		return team.members.find((member) => member.user.id === viewerId)?.role ?? null;
	}
	/** Rename/description edits: global manager, workspace owner or team admin. */
	function canEditTeam(team: TeamDto) {
		const role = viewerRoleIn(team);
		return canManageAll || team.ownerId === viewerId || role === "owner" || role === "admin";
	}
	/** Deletion is narrower: only a global manager or the workspace owner. */
	function canDeleteTeam(team: TeamDto) {
		return canManageAll || team.ownerId === viewerId || viewerRoleIn(team) === "owner";
	}

	async function refresh() {
		setLoading(true);
		try {
			const data = await csrfFetch<{ teams: TeamDto[]; currentTeamId: string | null }>("/api/teams");
			setTeams(data.teams ?? []);
			setCurrentTeamId(data.currentTeamId ?? null);
			const manageable = (data.teams ?? []).filter((team) => canEditTeam(team));
			setTargetTeamId((prev) =>
				manageable.some((team) => team.id === prev) ? prev : manageable[0]?.id || "",
			);
		} catch (err) {
			setError(getErrorMessage(err, t("settingsTeam.error.load")));
		} finally {
			setLoading(false);
		}
	}

	useEffect(() => {
		const timer = window.setTimeout(() => { void refresh(); }, 0);
		return () => window.clearTimeout(timer);
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
			setError(getErrorMessage(err, t("settingsTeam.error.create")));
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
			setCurrentTeamId(teamId);
			setMessage(t("settingsTeam.message.switched"));
			await refresh();
			router.refresh();
		} catch (err) {
			setError(getErrorMessage(err, t("settingsTeam.error.switch")));
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
			setError(getErrorMessage(err, t("settingsTeam.error.addMember")));
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
			setError(getErrorMessage(err, t("settingsTeam.error.update")));
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
			setError(getErrorMessage(err, t(pendingConfirm.kind === "removeMember" ? "settingsTeam.error.removeMember" : "settingsTeam.error.delete")));
		} finally {
			setBusy(false);
		}
	}

	const manageableTeams = teams.filter((team) => canEditTeam(team));
	const confirmTitle = pendingConfirm?.kind === "removeMember" ? t("settingsTeam.confirm.removeMember.title") : t("settingsTeam.confirm.deleteTeam.title");
	const confirmDesc = pendingConfirm
		? formatCopy(t(pendingConfirm.kind === "removeMember" ? "settingsTeam.confirm.removeMember.desc" : "settingsTeam.confirm.deleteTeam.desc"), { name: pendingConfirm.name })
		: "";

	return (
		<section id="team-workspaces" className="min-w-0 space-y-4 border-t border-[var(--border)] py-5">
			<div>
				<p className="text-xs font-semibold uppercase text-[var(--color-action)]">{t("settingsTeam.eyebrow")}</p>
				<h2 className="mt-1 text-xl font-semibold text-[var(--text-primary)]">{t("settingsTeam.title")}</h2>
			</div>

			{error && <Notice tone="danger">{error}</Notice>}
			{message && <Notice tone="success">{message}</Notice>}

			{loading ? (
				<p className="text-sm text-[var(--text-muted)]">{t("settingsTeam.loading")}</p>
			) : teams.length === 0 ? (
				<p className="text-sm text-[var(--text-muted)]">{t("settingsTeam.empty")}</p>
			) : (
				<div className="grid gap-3 md:grid-cols-2">
					{teams.map((team) => (
						<article key={team.id} className="min-w-0 rounded-lg border border-[var(--border)] p-4">
							<div className="flex items-start justify-between gap-3">
								<div className="min-w-0 flex-1 break-words">
									{editingTeamId === team.id ? (
										<div className="space-y-1">
											<input value={editName} aria-label={t("settingsTeam.namePlaceholder")} onChange={(e) => setEditName(e.target.value)} className={UI_INPUT} />
											<input value={editDesc} aria-label={t("settingsTeam.descriptionPlaceholder")} onChange={(e) => setEditDesc(e.target.value)} placeholder={t("settingsTeam.descriptionPlaceholder")} className={UI_INPUT} />
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
									<ActionButton variant="secondary" disabled={busy || currentTeamId === team.id} onClick={() => switchTeam(team.id)} className="!min-h-9 !px-3 !py-1 !text-sm disabled:opacity-60">
										{currentTeamId === team.id ? t("settingsTeam.current") : t("settingsTeam.switch")}
									</ActionButton>
									{canEditTeam(team) && editingTeamId !== team.id && (
										<ActionButton variant="secondary" disabled={busy} onClick={() => startEditTeam(team)} className="!min-h-9 !px-3 !py-1 !text-sm disabled:opacity-60">
											{t("settingsTeam.edit")}
										</ActionButton>
									)}
									{canEditTeam(team) && editingTeamId === team.id && (
										<ActionButton variant="success" disabled={busy || !editName.trim()} onClick={() => saveEditTeam(team.id)} className="!min-h-9 !px-3 !py-1 !text-sm disabled:opacity-60">
											{t("settingsTeam.save")}
										</ActionButton>
									)}
									{editingTeamId === team.id && <ActionButton variant="secondary" disabled={busy} onClick={() => setEditingTeamId(null)}>{t("settingsTeam.confirm.cancel")}</ActionButton>}
									{canDeleteTeam(team) && (
										<ActionButton variant="danger" disabled={busy} onClick={() => deleteTeamSpace(team.id, team.name)} className="!min-h-9 !px-3 !py-1 !text-sm disabled:opacity-60">
											{t("settingsTeam.delete")}
										</ActionButton>
									)}
								</div>
							</div>
							<ul className="mt-3 space-y-1 text-xs text-[var(--text-secondary)]">
								{(expandedTeamIds.has(team.id) ? team.members : team.members.slice(0, 10)).map((member) => (
									<li key={member.user.id} className="flex items-center justify-between gap-2">
										<span className="min-w-0 break-words">{member.user.displayName || member.user.username}</span>
										<span className="flex items-center gap-2">
											<span className="text-[var(--text-muted)]">{member.role}</span>
											{canManageMembers && canEditTeam(team) && member.role !== "owner" && (
												<IconButton label={t("settingsTeam.confirm.removeMember.title")} tone="danger" disabled={busy} onClick={() => removeMember(team.id, member.user.id, member.user.displayName || member.user.username)}><X size={14} aria-hidden /></IconButton>
											)}
										</span>
									</li>
								))}
								{team.members.length > 10 && !expandedTeamIds.has(team.id) && (
									<li><ActionButton variant="ghost" onClick={() => setExpandedTeamIds((previous) => new Set(previous).add(team.id))}>{formatCopy(t("settingsTeam.moreMembers"), { count: team.members.length - 10 })}</ActionButton></li>
								)}
							</ul>
						</article>
					))}
				</div>
			)}

			{(canCreate || (canManageMembers && manageableTeams.length > 0)) && (
				<div className="grid gap-4 border-t border-[var(--border-subtle)] pt-4 md:grid-cols-2">
					{canCreate && (
					<div className="space-y-2">
						<h3 className="text-sm font-semibold text-[var(--text-primary)]">{t("settingsTeam.createTitle")}</h3>
						<input value={name} aria-label={t("settingsTeam.namePlaceholder")} onChange={(e) => setName(e.target.value)} placeholder={t("settingsTeam.namePlaceholder")} className={UI_INPUT} />
						<input value={slug} aria-label={t("settingsTeam.slugPlaceholder")} onChange={(e) => setSlug(e.target.value)} placeholder={t("settingsTeam.slugPlaceholder")} className={UI_INPUT} />
						<ActionButton variant="primary" disabled={busy || !name.trim()} onClick={createTeam} className="min-h-10 disabled:opacity-60">{t("settingsTeam.createButton")}</ActionButton>
					</div>
					)}
					{canManageMembers && manageableTeams.length > 0 && (
					<div className="space-y-2">
						<h3 className="text-sm font-semibold text-[var(--text-primary)]">{t("settingsTeam.addMemberTitle")}</h3>
						<select aria-label={t("settingsTeam.addMemberTitle")} value={targetTeamId} onChange={(e) => setTargetTeamId(e.target.value)} className={UI_INPUT}>
							{/* Only workspaces the viewer can actually manage — the API 403s otherwise. */}
							{manageableTeams.map((team) => <option key={team.id} value={team.id}>{team.name}</option>)}
						</select>
						<input value={memberUsername} aria-label={t("settingsTeam.usernamePlaceholder")} onChange={(e) => setMemberUsername(e.target.value)} placeholder={t("settingsTeam.usernamePlaceholder")} className={UI_INPUT} />
						<select aria-label={t("settingsTeam.roleAria")} value={memberRole} onChange={(e) => setMemberRole(e.target.value as "admin" | "member")} className={UI_INPUT}>
							<option value="member">{t("settingsTeam.role.member")}</option>
							<option value="admin">{t("settingsTeam.role.admin")}</option>
						</select>
						<ActionButton variant="primary" disabled={busy || !targetTeamId || !memberUsername.trim()} onClick={addMember} className="min-h-10 disabled:opacity-60">{t("settingsTeam.addMemberButton")}</ActionButton>
					</div>
					)}
				</div>
			)}

			<ConfirmDialog open={pendingConfirm !== null} title={confirmTitle} description={confirmDesc} cancelLabel={t("settingsTeam.confirm.cancel")} confirmLabel={t("settingsTeam.confirm.submit")} onCancel={() => setPendingConfirm(null)} onConfirm={() => void confirmPendingAction()} busy={busy} closeOnBackdrop={false} />
		</section>
	);
}
