import type { ReactNode } from "react";
import { requirePagePermission } from "@/lib/auth/page-guard";
import { sessionHasPermission } from "@/lib/auth/authorization";
import { getPendingActionPage } from "@/lib/ai/hosted-service";
import { getCommandRequestForViewer, listCommandRequestPage } from "@/lib/command/service";
import { mayReviewCommandRequest } from "@/lib/command/review-scope";
import { firstSearchParam } from "@/lib/http/first-search-param";
import { ReviewCommandForm } from "./review-command-form";
import { CancelCommandButton } from "./cancel-command-button";
import { AiHostedApprovalCard } from "./ai-hosted-approval-card";
import { BatchReviewToolbar, BatchSelectCheckbox } from "./batch-review-toolbar";
import { PageShell, PageHeader, StatCard, StatGrid, EmptyState, ListPanel } from "@/components/page-shell";
import { ButtonLink } from "@/components/action-button";
import { StatusBadge } from "@/components/status-badge";
import { Badge, type BadgeTone } from "@/components/ui-primitives";
import { getServerLocale, t } from "@/lib/i18n/translations";
import { ExecutionEvidence } from "@/components/execution-evidence";
import { formatDateTime } from "@/lib/datetime/format";
import { getDomainStatusLabel } from "@/lib/i18n/domain-labels";
import { PaginatedList } from "@/components/paginated-list";
import { Disclosure } from "@/components/ui/disclosure";
import { Notice } from "@/components/ui-primitives";

export const dynamic = "force-dynamic";

const ACTIVE_REQUEST_STATUSES = new Set(["PENDING_APPROVAL", "APPROVED", "RUNNING", "CANCELLING"]);

export default async function RequestsPage({ searchParams }: { searchParams?: Promise<{ after?: string | string[]; aiAfter?: string | string[]; requestId?: string | string[] }> }) {
	const params = await searchParams;
	const rawRequestId = firstSearchParam(params?.requestId)?.trim();
	const requestedId = rawRequestId && rawRequestId.length <= 64 ? rawRequestId : undefined;
	const session = await requirePagePermission("command:read", {
		redirectTo: requestedId ? `/requests?requestId=${encodeURIComponent(requestedId)}` : "/requests",
	});
	const canApprove = sessionHasPermission(session, "command:approve");
	// A reviewer's own request goes to another reviewer unless the account manages the team: the server refuses the
	// decision otherwise, and the form, the batch checkbox and the dashboard's count all followed "may approve" alone.
	const awaitsThisReviewer = (request: { status: string; runInitiatorId: string | null; unattributedManualRun: boolean; requester: { id: string } }) =>
		request.status === "PENDING_APPROVAL" && mayReviewCommandRequest(session, request.requester.id, request.runInitiatorId, request.unattributedManualRun);
	// Who a cancel request is accepted from (PATCH /api/commands, cancelCommandRequest): a member who may execute
	// commands, for a request of their own, and for anyone's when they may also approve. The button followed
	// "may approve" alone: an operator could not stop the command they had just started, and a reviewer without
	// the execute permission was shown a button the server refuses.
	const canExecute = sessionHasPermission(session, "command:execute");
	const canCancelOthers = canExecute && (canApprove || sessionHasPermission(session, "team:manage"));
	// A member who may only submit withdraws their own request while it waits for approval.
	const canSubmit = sessionHasPermission(session, "command:create");
	const canReadServers = sessionHasPermission(session, "server:read");
	const canReadTemplates = sessionHasPermission(session, "command:read");
	const mayCancel = (request: { status: string; requester: { id: string } }) => {
		const own = request.requester.id === session.userId;
		if (!["PENDING_APPROVAL", "APPROVED", "RUNNING"].includes(request.status)) return false;
		return canCancelOthers || (canExecute && own) || (canSubmit && own && request.status === "PENDING_APPROVAL");
	};
	const locale = await getServerLocale();
	const cursor = typeof params?.after === "string" ? params.after : undefined;
	const aiCursor = typeof params?.aiAfter === "string" ? params.aiAfter : undefined;
	const pageUrl = (after?: string | null, aiAfter?: string | null) => {
		const query = new URLSearchParams();
		if (after) query.set("after", after);
		if (aiAfter) query.set("aiAfter", aiAfter);
		return query.size ? "/requests?" + query.toString() : "/requests";
	};
	const [{ requests, nextCursor, pendingCount }, { actions: aiActions, total: aiCount, nextCursor: nextAiCursor }, focusedRequest] = await Promise.all([
		listCommandRequestPage(session, cursor, 20),
		sessionHasPermission(session, "ai:chat") ? getPendingActionPage(session, aiCursor) : { actions: [], total: 0, nextCursor: null },
		requestedId ? getCommandRequestForViewer(session, requestedId) : Promise.resolve(null),
	]);

	// Sort: actionable statuses first (PENDING_APPROVAL → APPROVED/RUNNING → terminal),
	// then newest first within each bucket. This makes the list match the
	// "待审批 N" stat card instead of mixing rejected/completed at the top.
	const STATUS_RANK: Record<string, number> = {
		PENDING_APPROVAL: 0,
		APPROVED: 1,
		RUNNING: 1,
		CANCELLING: 1,
		COMPLETED: 2,
		FAILED: 2,
		CANCELLED: 3,
		REJECTED: 3,
	};
	const sortedRequests = [...requests].sort((a, b) => {
		const rankA = STATUS_RANK[a.status] ?? 99;
		const rankB = STATUS_RANK[b.status] ?? 99;
		if (rankA !== rankB) return rankA - rankB;
		// newest first within same rank — use request createdAt as tiebreaker
		const aTime = new Date(a.createdAt as unknown as string).getTime() || 0;
		const bTime = new Date(b.createdAt as unknown as string).getTime() || 0;
		return bTime - aTime;
	});

	// The queue holds what still needs a decision or is in flight; finished
	// requests move to a folded history so they do not bury the next approval.
	const visibleListRequests = focusedRequest
		? sortedRequests.filter((r) => r.id !== focusedRequest.id)
		: sortedRequests;
	const activeRequests = visibleListRequests.filter((r) => ACTIVE_REQUEST_STATUSES.has(r.status));
	const handledRequests = visibleListRequests.filter((r) => !ACTIVE_REQUEST_STATUSES.has(r.status));
	const renderRequest = (request: (typeof sortedRequests)[number]) => {
		const isActionable = ACTIVE_REQUEST_STATUSES.has(request.status);
		return (
								<article id={`command-${request.id}`} key={request.id} data-id={request.id} data-card className={`p-5 transition-colors duration-150 hover:bg-[var(--surface-elevated)] ${isActionable ? "" : "bg-[var(--surface-subtle)]"}`}>
								<div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
									<div className="min-w-0 flex-1">
										<div className="flex flex-wrap items-center gap-2">
											<BatchSelectCheckbox id={request.id} />
											<h3 className="ui-title-section">{request.title}</h3>
											<ApprovalBadge status={request.status} label={getRequestStatusLabel(request.status, locale)} />
											<InitiatorBadge assistant={request.isAssistantInitiated} label={t(request.isAssistantInitiated ? "requestsPage.initiator.assistant" : "requestsPage.initiator.user", locale)} />
										</div>
										{/* Reviewers read every command; a submitter reads their own, which they could not see before. */}
										{canApprove || request.requester.id === session.userId ? (
											<p data-inset="" className="mt-2.5 px-3 py-2 font-mono text-xs text-[var(--text-primary)]">{request.command}</p>
										) : (
											<p data-inset="" className="mt-2.5 px-3 py-2 font-mono text-xs text-[var(--text-muted)]">{t("requestsPage.card.approvalOnly", locale)}</p>
										)}
										{request.reason && <p className="mt-2 text-sm text-[var(--text-secondary)]">{t("requestsPage.card.reason", locale)}{request.reason}</p>}
										<p className="mt-1 text-xs text-[var(--text-muted)]">{t("requestsPage.card.requester", locale)}{request.requester.displayName || request.requester.username}</p>
										</div>
										<div data-tile className="shrink-0 px-3 py-2 text-xs text-[var(--text-secondary)]">
										{t("requestsPage.card.targetCount", locale, { count: request.targetCount })}
										</div>
								</div>

								<div className="mt-4 grid gap-3 lg:grid-cols-3">
									<InfoSection title={t("requestsPage.card.targetNodesTitle", locale)}>
										{request.targets.length === 0 ? (
											<p className="text-xs text-[var(--text-muted)]">{t("requestsPage.card.noTargets", locale)}</p>
										) : null}
										<div className="space-y-1.5">
											{request.targets.map((target: (typeof request.targets)[number]) => (
												<InfoItem key={target.id}>
													<div className="text-sm font-medium text-[var(--text-primary)]">{target.server?.name ?? target.id}</div>
											<div className="text-xs text-[var(--text-muted)]">{target.server && `${target.server.host}:${target.server.port} · `}{getDomainStatusLabel((key) => t(key, locale), target.status)}</div>
												<ExecutionEvidence target={target} translate={(key) => t(key, locale)} />
												{target.status === "COMPLETED" && !target.outcomeUnknown && target.finishedAt &&
													<p className="text-xs text-[var(--text-muted)]">{t("serverOverviewDetails.success.command", locale)} · {formatDateTime(target.finishedAt, locale)}</p>}
												</InfoItem>
											))}
										</div>
									</InfoSection>

									{request.latestApproval ? (
										<InfoSection title={t("requestsPage.card.latestApprovalTitle", locale)}>
											<InfoItem className="text-sm">
												<div className={`font-medium ${request.latestApproval.approved ? "text-[var(--success)]" : "text-[var(--danger)]"}`}>
													{t(request.latestApproval.approved ? "requestsPage.status.APPROVED" : "requestsPage.status.REJECTED", locale)}
												</div>
												<div className="mt-1 text-xs text-[var(--text-muted)]">
													{request.latestApproval.approver.displayName || request.latestApproval.approver.username}
												</div>
												{request.latestApproval.comment && <div className="mt-1.5 text-xs text-[var(--text-secondary)]">{request.latestApproval.comment}</div>}
											</InfoItem>
										</InfoSection>
									) : (
										<Disclosure variant="inset" title={t("requestsPage.card.latestApprovalTitle", locale)}>
											<p className="text-xs text-[var(--text-muted)]">{t("requestsPage.card.latestApprovalEmpty", locale)}</p>
										</Disclosure>
									)}

									{request.executionLogs.length > 0 ? (
										<InfoSection title={t("requestsPage.card.executionLogsTitle", locale)}>
											<div className="space-y-2">
												{request.executionLogs.map((log: (typeof request.executionLogs)[number], index: number) => (
													<InfoItem key={log.id ?? `${request.id}-log-${index}`} className="text-xs text-[var(--text-secondary)]">
														<div>{log.summary}</div>
														{log.createdAt && <div className="mt-1 text-xs text-[var(--text-muted)]">{formatDateTime(log.createdAt, locale)}</div>}
													</InfoItem>
												))}
											</div>
										</InfoSection>
									) : (
										<Disclosure variant="inset" title={t("requestsPage.card.executionLogsTitle", locale)}>
											<p className="text-xs text-[var(--text-muted)]">{t("requestsPage.card.executionLogsEmpty", locale)}</p>
										</Disclosure>
									)}
								</div>

								{awaitsThisReviewer(request) ? (
									<ReviewCommandForm commandRequestId={request.id} />
								) : canApprove && !request.unattributedManualRun && request.status === "PENDING_APPROVAL" ? (
									<p className="mt-4 text-xs text-[var(--text-muted)]">{t("requestsPage.review.ownRequest", locale)}</p>
								) : null}
								{mayCancel(request) && (
									<CancelCommandButton commandRequestId={request.id} commandTitle={request.title} />
								)}
								</article>
		);
	};

	const pendingCommands = pendingCount;
	const assistantCommands = requests.filter((r) => r.isAssistantInitiated).length;
	const userCommands = requests.filter((r) => !r.isAssistantInitiated).length;
	const completed = requests.filter((r) => r.status === "COMPLETED").length;

	return (
		<PageShell>
			<PageHeader
			eyebrow={t("requestsPage.eyebrow", locale)}
			title={t("requestsPage.title", locale)}
			description={t("requestsPage.desc", locale)}
		/>
			{/* How the two approval chains work: a note under the header, not text in the action slot. */}
			<Notice tone="info" title={t("requestsPage.workflowNote.title", locale)} className="mb-5">
				{t("requestsPage.workflowNote.desc", locale)}
			</Notice>

			<StatGrid cols={5}>
				<StatCard label={t("requestsPage.stat.aiPending", locale)} value={String(aiCount)} accent={aiCount > 0} accentColor="cyan" />
				<StatCard label={t("requestsPage.stat.cmdPending", locale)} value={String(pendingCommands)} accent={pendingCommands > 0} accentColor="amber" />
				<StatCard label={t("requestsPage.stat.assistant", locale)} value={String(assistantCommands)} accent={assistantCommands > 0} accentColor="cyan" />
				<StatCard label={t("requestsPage.stat.user", locale)} value={String(userCommands)} />
				<StatCard label={t("requestsPage.stat.completed", locale)} value={String(completed)} />
			</StatGrid>

			<div className="space-y-6">
				{requestedId ? (
					<section aria-label={t("requestsPage.focused.title", locale)}>
						{focusedRequest ? (
							<ListPanel
								title={t("requestsPage.focused.title", locale)}
								actions={
									<ButtonLink href="/requests" size="sm" variant="secondary">
										{t("requestsPage.focused.viewAll", locale)}
									</ButtonLink>
								}
								bodyClassName="bg-transparent p-3"
							>
								{renderRequest(focusedRequest)}
							</ListPanel>
						) : (
							<Notice
								tone="info"
								title={t("requestsPage.focused.title", locale)}
							>
								<div className="flex flex-wrap items-center justify-between gap-3">
									<span>{t("requestsPage.focused.notFound", locale)}</span>
									<ButtonLink href="/requests" size="xs" variant="secondary">
										{t("requestsPage.focused.viewAll", locale)}
									</ButtonLink>
								</div>
							</Notice>
						)}
					</section>
				) : null}

				{/* The list panel's own title is the section's heading; a hidden copy of it read every name twice. */}
				<section aria-label={t("requestsPage.ai.title", locale)}>
					<ListPanel
						title={t("requestsPage.ai.title", locale)}
						description={t("requestsPage.ai.desc", locale)}
						count={aiCount}
						actions={<StatusBadge tone="accent">{t("requestsPage.ai.scopeBadge", locale)}</StatusBadge>}
						empty={aiActions.length === 0 ? <EmptyState text={t("requestsPage.ai.empty", locale)} /> : undefined}
						bodyClassName={aiActions.length === 0 ? undefined : "!divide-y-0 space-y-0 bg-transparent p-3"}
					>
						{aiActions.map((action) => (
							<div key={action.id} className="mb-3 last:mb-0">
								<AiHostedApprovalCard action={action} />
							</div>
						))}
						{(aiCursor || nextAiCursor) && <nav className="flex gap-2 p-3" aria-label={t("requestsPage.ai.title", locale)}>
							{aiCursor && <ButtonLink href={pageUrl(cursor)} size="sm" variant="secondary">{t("common.pagination.firstPage", locale)}</ButtonLink>}
							{nextAiCursor && <ButtonLink href={pageUrl(cursor, nextAiCursor)} size="sm" variant="secondary">{t("common.pagination.next", locale)}</ButtonLink>}
						</nav>}
					</ListPanel>
				</section>

				<section aria-label={t("requestsPage.cmd.title", locale)}>
					<ListPanel
						title={t("requestsPage.cmd.title", locale)}
						description={t("requestsPage.cmd.desc", locale)}
						count={activeRequests.length}
						actions={<StatusBadge tone="warning">{t("requestsPage.cmd.scopeBadge", locale)}</StatusBadge>}
						empty={visibleListRequests.length === 0 && !focusedRequest ? (
							<EmptyState
								title={t("requestsPage.cmd.empty", locale)}
								text={t("requestsPage.cmd.emptyHint", locale)}
								action={canReadServers || canReadTemplates ? (
									<div className="flex flex-wrap justify-center gap-2">
										{canReadServers ? (
											<ButtonLink href="/servers" size="sm" variant="secondary">
												{t("requestsPage.cmd.openServers", locale)}
											</ButtonLink>
										) : null}
										{canReadTemplates ? (
											<ButtonLink href="/templates" size="sm" variant="secondary">
												{t("requestsPage.cmd.openTemplates", locale)}
											</ButtonLink>
										) : null}
									</div>
								) : undefined}
							/>
						) : undefined}
						bodyClassName={visibleListRequests.length === 0 ? undefined : "!divide-y-0 space-y-0 bg-transparent p-3"}
						>
						{activeRequests.length > 0 ? (
						<BatchReviewToolbar
							pendingIds={activeRequests.filter(awaitsThisReviewer).map((r) => r.id)}
						>
							{activeRequests.map(renderRequest)}
						</BatchReviewToolbar>
						) : visibleListRequests.length > 0 ? <EmptyState text={t("requestsPage.cmd.noActive", locale)} /> : null}
						{(cursor || nextCursor) && <nav className="flex gap-2 p-3" aria-label={t("common.pagination.label", locale)}>
							{cursor && <ButtonLink href={pageUrl(null, aiCursor)} size="sm" variant="secondary">{t("common.pagination.firstPage", locale)}</ButtonLink>}
							{nextCursor && <ButtonLink href={pageUrl(nextCursor, aiCursor)} size="sm" variant="secondary">{t("common.pagination.next", locale)}</ButtonLink>}
						</nav>}
						{handledRequests.length > 0 ? (
							<Disclosure variant="inset" title={t("requestsPage.cmd.history", locale)} count={handledRequests.length}>
								<PaginatedList pageSize={20}>{handledRequests.map(renderRequest)}</PaginatedList>
							</Disclosure>
						) : null}
					</ListPanel>
				</section>
			</div>
		</PageShell>
	);
}

function getRequestStatusLabel(status: string, locale: Parameters<typeof t>[1]) {
	switch (status) {
		case "PENDING_APPROVAL":
			return t("requestsPage.status.PENDING_APPROVAL", locale);
		case "APPROVED":
			return t("requestsPage.status.APPROVED", locale);
		case "REJECTED":
			return t("requestsPage.status.REJECTED", locale);
		case "RUNNING":
			return t("requestsPage.status.RUNNING", locale);
		case "COMPLETED":
			return t("requestsPage.status.COMPLETED", locale);
		case "FAILED":
			return t("requestsPage.status.FAILED", locale);
		case "CANCELLING":
			return t("requestsPage.status.CANCELLING", locale);
		case "CANCELLED":
			return t("requestsPage.status.CANCELLED", locale);
		default:
			return status;
	}
}

function ApprovalBadge({ status, label }: { status: string; label: string }) {
	const toneMap: Record<string, BadgeTone> = {
		PENDING_APPROVAL: "warning",
		APPROVED: "success",
		RUNNING: "accent",
		CANCELLING: "warning",
		COMPLETED: "success",
		REJECTED: "danger",
		FAILED: "danger",
		CANCELLED: "neutral",
	};
	return <Badge tone={toneMap[status] ?? "neutral"}>{label}</Badge>;
}

function InitiatorBadge({ assistant, label }: { assistant: boolean; label: string }) {
	return (
		<StatusBadge tone={assistant ? "accent" : "neutral"} size="sm">
			{label}
		</StatusBadge>
	);
}

function InfoSection({ title, children }: { title: string; children: ReactNode }) {
	return (
		<section data-inset className="p-4">
			<h4 className="ui-title-caption mb-3">{title}</h4>
			{children}
		</section>
	);
}

function InfoItem({ children, className }: { children: ReactNode; className?: string }) {
	return (
		<div data-inset="" className={`px-3 py-2 ${className ?? ""}`}>
			{children}
		</div>
	);
}
