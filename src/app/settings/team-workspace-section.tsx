"use client";

import { useEffect, useState } from "react";
import { csrfFetch } from "@/lib/auth/csrf-client";

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

export function TeamWorkspaceSection({ canManage }: { canManage: boolean }) {
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

	async function refresh() {
		setLoading(true);
		try {
			const data = await csrfFetch<{ teams: TeamDto[]; currentTeamId: string | null }>("/api/teams");
			setTeams(data.teams ?? []);
			setCurrentTeamId(data.currentTeamId ?? null);
			setTargetTeamId((prev) => prev || data.teams?.[0]?.id || "");
		} catch (err) {
			setError(err instanceof Error ? err.message : "加载团队空间失败");
		} finally {
			setLoading(false);
		}
	}

	useEffect(() => {
		void refresh();
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
			setMessage("团队空间已创建");
			await refresh();
		} catch (err) {
			setError(err instanceof Error ? err.message : "创建团队空间失败");
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
			setMessage("当前团队空间已切换");
		} catch (err) {
			setError(err instanceof Error ? err.message : "切换团队空间失败");
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
			setMessage("团队成员已更新");
			await refresh();
		} catch (err) {
			setError(err instanceof Error ? err.message : "添加成员失败");
		} finally {
			setBusy(false);
		}
	}

	return (
		<section id="team-workspaces" data-card className="space-y-4 p-5">
			<div>
				<p className="text-xs font-semibold uppercase tracking-[0.3em] text-cyan-300/80">Team Spaces</p>
				<h2 className="mt-1 text-xl font-semibold text-[var(--text-primary)]">团队空间</h2>
				<p className="mt-1 text-sm text-[var(--text-secondary)]">多租户基础骨架：创建团队、切换当前团队，并维护团队成员。资源级隔离可在此基础上逐表接入。</p>
			</div>

			{error && <div role="alert" className="rounded-xl border border-rose-400/20 bg-rose-500/10 px-3 py-2 text-sm text-rose-200">{error}</div>}
			{message && <div className="rounded-xl border border-emerald-400/20 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-200">{message}</div>}

			{loading ? (
				<p className="text-sm text-[var(--text-muted)]">加载团队空间中…</p>
			) : teams.length === 0 ? (
				<p className="text-sm text-[var(--text-muted)]">暂无团队空间。</p>
			) : (
				<div className="grid gap-3 md:grid-cols-2">
					{teams.map((team) => (
						<article key={team.id} className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--surface-subtle)] p-4">
							<div className="flex items-start justify-between gap-3">
								<div>
									<h3 className="font-semibold text-[var(--text-primary)]">{team.name}</h3>
									<p className="text-xs text-[var(--text-muted)]">/{team.slug} · {team.members.length} 成员</p>
								</div>
								<button type="button" disabled={busy || currentTeamId === team.id} onClick={() => switchTeam(team.id)} className="min-h-9 rounded-xl border border-[var(--border)] px-3 py-1 text-xs text-[var(--text-secondary)] disabled:opacity-60">
									{currentTeamId === team.id ? "当前团队" : "切换"}
								</button>
							</div>
							<ul className="mt-3 space-y-1 text-xs text-[var(--text-secondary)]">
								{team.members.slice(0, 6).map((member) => (
									<li key={member.user.id} className="flex justify-between gap-2">
										<span>{member.user.displayName || member.user.username}</span>
										<span className="text-[var(--text-muted)]">{member.role}</span>
									</li>
								))}
							</ul>
						</article>
					))}
				</div>
			)}

			{canManage && (
				<div className="grid gap-4 border-t border-[var(--border-subtle)] pt-4 md:grid-cols-2">
					<div className="space-y-2">
						<h3 className="text-sm font-semibold text-[var(--text-primary)]">创建团队空间</h3>
						<input value={name} onChange={(e) => setName(e.target.value)} placeholder="团队名称" className="w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm" />
						<input value={slug} onChange={(e) => setSlug(e.target.value)} placeholder="slug（可选，例如 ops-team）" className="w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm" />
						<button type="button" disabled={busy || !name.trim()} onClick={createTeam} data-tone="accent" className="min-h-10 rounded-xl border px-4 py-2 text-sm disabled:opacity-60">创建团队</button>
					</div>
					<div className="space-y-2">
						<h3 className="text-sm font-semibold text-[var(--text-primary)]">添加成员</h3>
						<select value={targetTeamId} onChange={(e) => setTargetTeamId(e.target.value)} className="w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm">
							{teams.map((team) => <option key={team.id} value={team.id}>{team.name}</option>)}
						</select>
						<input value={memberUsername} onChange={(e) => setMemberUsername(e.target.value)} placeholder="用户名" className="w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm" />
						<select value={memberRole} onChange={(e) => setMemberRole(e.target.value as "admin" | "member")} className="w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm">
							<option value="member">member</option>
							<option value="admin">admin</option>
						</select>
						<button type="button" disabled={busy || !targetTeamId || !memberUsername.trim()} onClick={addMember} data-tone="accent" className="min-h-10 rounded-xl border px-4 py-2 text-sm disabled:opacity-60">添加/更新成员</button>
					</div>
				</div>
			)}
		</section>
	);
}
