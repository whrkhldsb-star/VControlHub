import type { ReactNode } from "react";
import { requireSession } from "@/lib/auth/require-session";
import { sessionHasPermission } from "@/lib/auth/authorization";
import { getPendingActions } from "@/lib/ai/hosted-service";
import { listCommandRequests } from "@/lib/command/service";
import { ReviewCommandForm } from "./review-command-form";
import { CancelCommandButton } from "./cancel-command-button";
import { AiHostedApprovalCard } from "./ai-hosted-approval-card";
import { BatchReviewToolbar } from "./batch-review-toolbar";
import { PageShell, PageHeader, StatCard, EmptyState } from "@/components/page-shell";
import { getServerLocale, t } from "@/lib/i18n/translations";

export const dynamic = "force-dynamic";

export default async function RequestsPage() {
	const session = await requireSession("/requests");
	const canApprove = sessionHasPermission(session, "command:approve");
	const locale = await getServerLocale();
	const [requests, aiActions] = await Promise.all([
		listCommandRequests(),
		getPendingActions(session.userId),
	]);

	const pendingCommands = requests.filter((r) => r.status === "PENDING_APPROVAL").length;
	const assistantCommands = requests.filter((r) => r.isAssistantInitiated).length;
	const userCommands = requests.filter((r) => !r.isAssistantInitiated).length;
	const completed = requests.filter((r) => r.status === "COMPLETED").length;

	return (
		<PageShell maxW="max-w-7xl">
			<PageHeader
			eyebrow={t("requestsPage.eyebrow", locale)}
			title={t("requestsPage.title", locale)}
			description={t("requestsPage.desc", locale)}
		>
				<div data-card className="px-4 py-3 text-xs text-[var(--text-secondary)]">
					<div className="font-medium text-[var(--text-secondary)]">{t("requestsPage.workflowNote.title", locale)}</div>
					<div className="mt-1">{t("requestsPage.workflowNote.desc", locale)}</div>
				</div>
			</PageHeader>

			<section className="grid gap-3 sm:grid-cols-5 mb-8">
				<StatCard label={t("requestsPage.stat.aiPending", locale)} value={String(aiActions.length)} accent={aiActions.length > 0} accentColor="cyan" />
				<StatCard label={t("requestsPage.stat.cmdPending", locale)} value={String(pendingCommands)} accent={pendingCommands > 0} accentColor="amber" />
				<StatCard label={t("requestsPage.stat.assistant", locale)} value={String(assistantCommands)} accent={assistantCommands > 0} accentColor="cyan" />
				<StatCard label={t("requestsPage.stat.user", locale)} value={String(userCommands)} />
				<StatCard label={t("requestsPage.stat.completed", locale)} value={String(completed)} />
			</section>

			<div className="space-y-8">
				<section aria-labelledby="ai-approval-heading" className="space-y-3">
					<div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
						<div>
							<h2 id="ai-approval-heading" className="text-xl font-semibold text-[var(--text-primary)]">{t("requestsPage.ai.title", locale)}</h2>
							<p className="mt-1 text-sm text-[var(--text-muted)]">{t("requestsPage.ai.desc", locale)}</p>
						</div>
						<span data-tone="cyan" className="rounded-lg border border-[var(--color-action-border)]/20 px-3 py-1 text-xs text-[var(--text-secondary)]">{t("requestsPage.ai.scopeBadge", locale)}</span>
					</div>
					{aiActions.length === 0 ? (
						<EmptyState text={t("requestsPage.ai.empty", locale)} variant="boxed" />
					) : (
						<div className="space-y-3">
							{aiActions.map((action) => <AiHostedApprovalCard key={action.id} action={action} />)}
						</div>
					)}
				</section>

				<section aria-labelledby="command-approval-heading" className="space-y-3">
					<div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
						<div>
							<h2 id="command-approval-heading" className="text-xl font-semibold text-[var(--text-primary)]">{t("requestsPage.cmd.title", locale)}</h2>
							<p className="mt-1 text-sm text-[var(--text-muted)]">{t("requestsPage.cmd.desc", locale)}</p>
						</div>
						<span data-tone="amber" className="rounded-lg border border-amber-400/20 px-3 py-1 text-xs text-amber-200">{t("requestsPage.cmd.scopeBadge", locale)}</span>
					</div>

					{requests.length === 0 ? (
						<EmptyState text={t("requestsPage.cmd.empty", locale)} variant="boxed" />
					) : (
						<BatchReviewToolbar
							pendingIds={
								canApprove
									? requests
											.filter((r) => r.status === "PENDING_APPROVAL")
											.map((r) => r.id)
									: []
							}
						>
							{requests.map((request) => (
								<article key={request.id} data-id={request.id} data-card className=" hover:bg-[var(--surface)]/[0.04] transition-colors duration-150">
								<div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
									<div className="min-w-0 flex-1">
										<div className="flex flex-wrap items-center gap-2">
											<h3 className="text-lg font-semibold text-[var(--text-primary)]">{request.title}</h3>
											<ApprovalBadge status={request.approvalStateLabel} />
											<InitiatorBadge assistant={request.isAssistantInitiated} />
										</div>
										{canApprove ? (
											<p className="mt-2.5 rounded-lg bg-[var(--surface-subtle)] px-3 py-2 font-mono text-xs text-[var(--text-primary)] border border-[var(--border)]">{request.command}</p>
										) : (
											<p className="mt-2.5 rounded-lg bg-[var(--surface-subtle)] px-3 py-2 font-mono text-xs text-[var(--text-muted)] border border-[var(--border)]">{t("requestsPage.card.approvalOnly", locale)}</p>
										)}
										{request.reason && <p className="mt-2 text-sm text-[var(--text-secondary)]">{t("requestsPage.card.reason", locale)}{request.reason}</p>}
										<p className="mt-1 text-[11px] text-[var(--text-muted)]">{t("requestsPage.card.requester", locale)}{request.requester.displayName || request.requester.username}</p>
										</div>
										<div className="rounded-lg border border-[var(--border)] bg-[var(--surface)]/[0.04] px-3 py-2 text-xs text-[var(--text-secondary)] shrink-0">
										{t("requestsPage.card.targetCount", locale).replace("{count}", String(request.targets.length))}
										</div>
								</div>

								<div className="mt-4 grid gap-3 lg:grid-cols-3">
									<InfoSection title="目标节点">
										<div className="space-y-1.5">
											{request.targets.map((target: (typeof request.targets)[number]) => (
												<InfoItem key={target.id}>
													<div className="text-sm font-medium text-[var(--text-primary)]">{target.server.name}</div>
													<div className="text-[11px] text-[var(--text-muted)]">{target.server.host}:{target.server.port} · {target.status}</div>
												</InfoItem>
											))}
										</div>
									</InfoSection>

									<InfoSection title={t("requestsPage.card.latestApprovalTitle", locale)}>
										{request.latestApproval ? (
											<InfoItem className="text-sm">
												<div className={`font-medium ${request.latestApproval.approved ? "text-emerald-300" : "text-rose-300"}`}>
													{request.latestApproval.approved ? "已批准" : "已拒绝"}
												</div>
												<div className="mt-1 text-[11px] text-[var(--text-muted)]">
													{request.latestApproval.approver.displayName || request.latestApproval.approver.username}
												</div>
												{request.latestApproval.comment && <div className="mt-1.5 text-xs text-[var(--text-secondary)]">{request.latestApproval.comment}</div>}
											</InfoItem>
										) : (
											<p className="text-xs text-[var(--text-muted)]">{t("requestsPage.card.latestApprovalEmpty", locale)}</p>
										)}
									</InfoSection>

									<InfoSection title={t("requestsPage.card.executionLogsTitle", locale)}>
										{request.executionLogs.length > 0 ? (
											<div className="space-y-2">
												{request.executionLogs.map((log: (typeof request.executionLogs)[number], index: number) => (
													<InfoItem key={log.id ?? `${request.id}-log-${index}`} className="text-xs text-[var(--text-secondary)]">
														<div>{log.summary}</div>
														{log.createdAt && <div className="mt-1 text-[11px] text-[var(--text-muted)]">{new Date(log.createdAt).toLocaleString("zh-CN")}</div>}
													</InfoItem>
												))}
											</div>
										) : (
											<p className="text-xs text-[var(--text-muted)]">{t("requestsPage.card.executionLogsEmpty", locale)}</p>
										)}
									</InfoSection>
								</div>

								{canApprove && request.status === "PENDING_APPROVAL" && <ReviewCommandForm commandRequestId={request.id} />}
								{canApprove && ["PENDING_APPROVAL", "APPROVED", "RUNNING"].includes(request.status) && (
									<CancelCommandButton commandRequestId={request.id} commandTitle={request.title} />
								)}
								</article>
							))}
						</BatchReviewToolbar>
					)}
				</section>
			</div>
		</PageShell>
	);
}

function ApprovalBadge({ status }: { status: string }) {
	const toneMap: Record<string, "warning" | "success" | "danger" | "neutral"> = {
		"待审批": "warning",
		"已批准": "success",
		"已拒绝": "danger",
	};
	const styleMap: Record<string, string> = {
		待审批: "border-amber-400/20 text-amber-200",
		已批准: "border-emerald-400/20 text-emerald-200",
		已拒绝: "border-rose-400/20 text-rose-200",
	};
	const tone = toneMap[status];
	const style = styleMap[status] ?? "border-[var(--border)] text-[var(--text-secondary)]";
	return (
		<span
			data-tone={tone}
			className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium ${style}`}
		>
			{status}
		</span>
	);
}

function InitiatorBadge({ assistant }: { assistant: boolean }) {
	return (
		<span
			data-tone={assistant ? "accent" : "neutral"}
			className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium ${
				assistant ? "border-[var(--color-action-border)]/20 text-[var(--text-secondary)]" : "border-[var(--border)] text-[var(--text-muted)]"
			}`}
		>
			{assistant ? "助手授权" : "用户审批"}
		</span>
	);
}

function InfoSection({ title, children }: { title: string; children: ReactNode }) {
	return (
		<section className="rounded-lg border border-[var(--border)] bg-[var(--surface-subtle)] p-4">
			<h4 className="text-xs font-medium text-[var(--text-primary)]/70 uppercase tracking-wider mb-3">{title}</h4>
			{children}
		</section>
	);
}

function InfoItem({ children, className }: { children: ReactNode; className?: string }) {
	return (
		<div className={`rounded-lg bg-[var(--surface)]/[0.04] border border-[var(--border)] px-3 py-2 ${className ?? ""}`}>
			{children}
		</div>
	);
}
