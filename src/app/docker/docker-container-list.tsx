"use client";

import { EmptyState } from "@/components/page-shell";
import { ActionButton } from "@/components/action-button";
import { DockerContainerCard } from "./docker-container-card";
import { type Container, type ContainerStats } from "./docker-helpers";
import type { ProjectAction } from "./use-docker-page";

export function DockerContainerList({
	loading,
	containers,
	grouped,
	ungrouped,
	t,
	stats,
	actionLoading,
	projectActionLoading,
	handleAction,
	handleProjectAction,
	fetchLogs,
	requestRemoval,
}: {
	loading: boolean;
	containers: Container[];
	grouped: { project: string; containers: Container[] }[];
	ungrouped: Container[];
	t: (key: string) => string;
	stats: Record<string, ContainerStats>;
	actionLoading: string | null;
	projectActionLoading: string | null;
	handleAction: (container: Container, action: "start" | "stop" | "restart" | "remove") => Promise<void>;
	handleProjectAction: (project: string, action: ProjectAction) => Promise<void>;
	fetchLogs: (id: string) => Promise<void>;
	requestRemoval: (container: Container) => void;
}) {
	const renderContainerCard = (c: Container, options?: { showComposeLabels?: boolean }) => (
		<DockerContainerCard
			key={c.Id}
			c={c}
			options={options}
			t={t}
			stats={stats}
			actionLoading={actionLoading}
			handleAction={handleAction}
			fetchLogs={fetchLogs}
			requestRemoval={requestRemoval}
		/>
	);

	if (loading) {
		return <div className="text-sm text-[var(--text-muted)]">{t("dockerPage.loading")}</div>;
	}
	if (containers.length === 0) {
		return <EmptyState text={t("dockerPage.empty")} variant="boxed" />;
	}
	return (
		<div className="space-y-4">
			{grouped.map((group) => (
				<section key={group.project} data-card className="p-4">
					<div className="mb-3 flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
						<div>
							<h2 className="text-sm font-medium text-[var(--text-primary)]">{group.project}</h2>
							<p className="text-[11px] text-[var(--text-muted)]">
								{t("dockerPage.group.subtitle").replace("{count}", String(group.containers.length))}
								{" ·"}
							{t("dockerPage.project.runningOf")
								.replace("{running}", String(group.containers.filter((c) => c.State ==="running").length))
								.replace("{total}", String(group.containers.length))}
							</p>
						</div>
						<div className="flex flex-wrap items-center gap-2" aria-label={t("dockerPage.project.actions")}>
							{(
								[
									["ps","dockerPage.project.ps","secondary"],
									["up","dockerPage.project.up","success"],
									["start","dockerPage.project.start","success"],
									["stop","dockerPage.project.stop","outline"],
									["restart","dockerPage.project.restart","primary"],
									["down","dockerPage.project.down","danger"],
								] as const
							).map(([action, labelKey, variant]) => {
								const busyKey = `${group.project}:${action}`;
								const busy = projectActionLoading === busyKey;
								return (
									<ActionButton variant={variant}
										key={action}
										onClick={() => void handleProjectAction(group.project, action)}
										disabled={projectActionLoading !== null}
									
										className="!min-h-11 !rounded-lg !px-2.5 !py-1 !text-[10px] !font-medium disabled:opacity-50"
									>
										{busy ? t("dockerPage.project.busy") : t(labelKey)}
									</ActionButton>
								);
							})}
						</div>
					</div>
					<div className="space-y-3">
						{group.containers.map((c) => renderContainerCard(c, { showComposeLabels: true }))}
					</div>
				</section>
			))}

			{ungrouped.length > 0 && (
				<section data-card className="p-4">
					<h2 className="text-sm font-medium text-[var(--text-primary)] mb-3">{t("dockerPage.ungrouped.title")}</h2>
					<div className="space-y-3">
						{ungrouped.map((c) => renderContainerCard(c))}
					</div>
				</section>
			)}
		</div>
	);
}
