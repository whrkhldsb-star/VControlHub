import type { ReactNode } from "react";
import Link from "next/link";
import { requirePagePermission } from "@/lib/auth/page-guard";
import { sessionHasPermission } from "@/lib/auth/authorization";
import { getPendingActionPage } from "@/lib/ai/hosted-service";
import { countPendingAiOpsRecommendations } from "@/lib/ai/ops/service";
import {
	getCommandRequestForViewer,
	listCommandRequestPage,
	type CommandRequestListFilter,
} from "@/lib/command/service";
import { getApprovalPolicySettings } from "@/lib/command/approval-policy-settings";
import { mayCancelCommandRequest, mayReviewCommandRequest } from "@/lib/command/review-scope";
import { firstSearchParam } from "@/lib/http/first-search-param";
import { aiConversationHref } from "@/lib/ui/deep-links";
import { ReviewCommandForm } from "./review-command-form";
import { CancelCommandButton } from "./cancel-command-button";
import { BatchReviewToolbar, BatchSelectCheckbox } from "./batch-review-toolbar";
import { PageShell, PageHeader, StatCard, StatGrid, EmptyState, ListPanel } from "@/components/page-shell";
import { ButtonLink } from "@/components/action-button";
import { StatusBadge, type StatusTone } from "@/components/status-badge";
import { Badge, TabNav, type BadgeTone } from "@/components/ui-primitives";
import { getServerLocale, t } from "@/lib/i18n/translations";
import { ExecutionEvidence } from "@/components/execution-evidence";
import { formatDateTime } from "@/lib/datetime/format";
import { getDomainStatusLabel } from "@/lib/i18n/domain-labels";
import { PaginatedList } from "@/components/paginated-list";
import { Disclosure } from "@/components/ui/disclosure";
import { Notice } from "@/components/ui-primitives";

export const dynamic = "force-dynamic";

const ACTIVE_REQUEST_STATUSES = new Set(["PENDING_APPROVAL", "APPROVED", "RUNNING", "CANCELLING"]);

/** The views of the page, each a server filter of GET /api/commands (`?tab=` here, `?filter=` there). */
type RequestTab = Exclude<CommandRequestListFilter, "all">;
const REQUEST_TABS: readonly RequestTab[] = ["waiting_on_me", "my_submissions", "open", "history"];

/** The origin chips, in their order (`?origin=`). */
const ORIGIN_FILTERS = ["USER_UI", "AI_CHAT", "AI_AUTOMATION", "DEPLOYMENT", "DEPLOYMENT_ROLLBACK", "SCHEDULED_TASK", "PLAYBOOK", "API"] as const;
type OriginFilter = (typeof ORIGIN_FILTERS)[number];

const AI_ORIGINS = new Set<string>(["AI_CHAT", "AI_AUTOMATION"]);
const PEOPLE_ORIGINS = new Set<string>(["USER_UI", "API"]);

function parseTab(value: string | undefined): RequestTab | null {
	const normalized = value === "all_open" ? "open" : value;
	return REQUEST_TABS.find((tab) => tab === normalized) ?? null;
}

function parseOrigin(value: string | undefined): OriginFilter | null {
	return ORIGIN_FILTERS.find((origin) => origin === value) ?? null;
}

type SearchParams = {
	after?: string | string[];
	requestId?: string | string[];
	tab?: string | string[];
	origin?: string | string[];
};

export default async function RequestsPage({ searchParams }: { searchParams?: Promise<SearchParams> }) {
	const params = await searchParams;
	const rawRequestId = firstSearchParam(params?.requestId)?.trim();
	const requestedId = rawRequestId && rawRequestId.length <= 64 ? rawRequestId : undefined;
	const session = await requirePagePermission("command:read", {
		redirectTo: requestedId ? `/requests?requestId=${encodeURIComponent(requestedId)}` : "/requests",
	});
	const canApprove = sessionHasPermission(session, "command:approve");
	const canReadServers = sessionHasPermission(session, "server:read");
	const canReadTemplates = sessionHasPermission(session, "command:read");
	const mayCancel = (request: { status: string; requester: { id: string } }) =>
		mayCancelCommandRequest(session, { status: request.status, requesterId: request.requester.id });
	const locale = await getServerLocale();

	// Approvers land on what waits for them; everyone else on what they submitted. "Waiting on me" is never
	// empty-by-construction: it is offered only to approvers.
	const tabs = canApprove ? REQUEST_TABS : REQUEST_TABS.filter((tab) => tab !== "waiting_on_me");
	const defaultTab: RequestTab = canApprove ? "waiting_on_me" : "my_submissions";
	const requestedTab = parseTab(firstSearchParam(params?.tab));
	const tab: RequestTab = requestedTab && tabs.includes(requestedTab) ? requestedTab : defaultTab;
	const origin = parseOrigin(firstSearchParam(params?.origin));
	const cursor = firstSearchParam(params?.after) || undefined;

	/** This page with one thing changed; the tab, the origin and a deep-linked request are kept otherwise. */
	const pageUrl = (next: { tab?: RequestTab; origin?: OriginFilter | null; after?: string | null; requestId?: string | null }) => {
		const query = new URLSearchParams();
		const nextTab = next.tab ?? tab;
		if (nextTab !== defaultTab) query.set("tab", nextTab);
		const nextOrigin = next.origin === undefined ? origin : next.origin;
		if (nextOrigin) query.set("origin", nextOrigin);
		if (next.after) query.set("after", next.after);
		const nextRequest = next.requestId === undefined ? requestedId : next.requestId;
		if (nextRequest) query.set("requestId", nextRequest);
		return query.size ? `/requests?${query.toString()}` : "/requests";
	};

	const canChatAi = sessionHasPermission(session, "ai:chat");
	// AI ops records are cross-customer: their page is for platform admins (assertAiOpsPlatformReader).
	const canSeeAiOps = sessionHasPermission(session, "ai:ops:read") && sessionHasPermission(session, "team:manage");
	const [{ requests, nextCursor, pendingCount }, aiPending, focusedRequest, pendingAiOpsCount, policies] = await Promise.all([
		listCommandRequestPage(session, cursor, 20, { filter: tab, ...(origin ? { origin } : {}) }),
		// Only to count the requester's unconfirmed proposals: they are confirmed in their conversation, not here.
		canChatAi ? getPendingActionPage(session).catch(() => null) : Promise.resolve(null),
		requestedId ? getCommandRequestForViewer(session, requestedId) : Promise.resolve(null),
		canSeeAiOps ? countPendingAiOpsRecommendations().catch(() => 0) : Promise.resolve(0),
		getApprovalPolicySettings(),
	]);
	const awaitsThisReviewer = (request: { status: string; runInitiatorId: string | null; unattributedManualRun: boolean; requester: { id: string } }) =>
		request.status === "PENDING_APPROVAL" &&
		mayReviewCommandRequest(
			session,
			request.requester.id,
			request.runInitiatorId,
			request.unattributedManualRun,
			policies.commandSelfReview,
		);
	const pendingHostedActionCount = aiPending?.total ?? 0;
	const latestProposal = aiPending?.actions[0] ?? null;

	// Sort: actionable statuses first (PENDING_APPROVAL → APPROVED/RUNNING → terminal),
	// then newest first within each bucket.
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
	const requestOrigin = (request: (typeof sortedRequests)[number]): string =>
		request.origin ?? (request.isAssistantInitiated ? "AI_CHAT" : "USER_UI");
	const translated = (key: string, fallback: string) => {
		const value = t(key, locale);
		return value === key ? fallback : value;
	};

	const renderRequest = (request: (typeof sortedRequests)[number]) => {
		const isActionable = ACTIVE_REQUEST_STATUSES.has(request.status);
		const source = requestOrigin(request);
		const riskReasons = Array.isArray(request.riskReasons) ? request.riskReasons : [];
		return (
								<article id={`command-${request.id}`} key={request.id} data-id={request.id} data-origin={source} data-card className={`p-5 transition-colors duration-150 hover:bg-[var(--surface-elevated)] ${isActionable ? "" : "bg-[var(--surface-subtle)]"} ${request.id === requestedId ? "ring-2 ring-[var(--accent)]" : ""}`}>
								<div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
									<div className="min-w-0 flex-1">
										<div className="flex flex-wrap items-center gap-2">
											<BatchSelectCheckbox id={request.id} />
											<h3 className="ui-title-section">{request.title}</h3>
											<ApprovalBadge status={request.status} label={getRequestStatusLabel(request.status, locale)} />
											<OriginBadge origin={source} label={translated(`requestsPage.origin.${source}`, source)} />
											{request.riskLevel ? (
												<Badge tone={riskTone(request.riskLevel)} data-risk={request.riskLevel}>
													{t("requestsPage.card.risk", locale, { risk: translated(`requestsPage.risk.${request.riskLevel}`, request.riskLevel) })}
												</Badge>
											) : null}
										</div>
										{/* Reviewers read every command; a submitter reads their own, which they could not see before. */}
										{canApprove || request.requester.id === session.userId ? (
											<p data-inset="" className="mt-2.5 px-3 py-2 font-mono text-xs text-[var(--text-primary)]">{request.command}</p>
										) : (
											<p data-inset="" className="mt-2.5 px-3 py-2 font-mono text-xs text-[var(--text-muted)]">{t("requestsPage.card.approvalOnly", locale)}</p>
										)}
										{request.reason && <p className="mt-2 text-sm text-[var(--text-secondary)]">{t("requestsPage.card.reason", locale)}{request.reason}</p>}
										<p className="mt-1 text-xs text-[var(--text-muted)]">{t("requestsPage.card.requester", locale)}{request.requester.displayName || request.requester.username}</p>
										{request.decisionSource ? (
											<p className="mt-1 text-xs text-[var(--text-muted)]" data-decision-source={request.decisionSource}>
												{t("requestsPage.card.decisionSource", locale, { source: translated(`requestsPage.decisionSource.${request.decisionSource}`, request.decisionSource) })}
											</p>
										) : null}
										{riskReasons.length > 0 ? (
											<div className="mt-2 text-xs">
												<p className="text-[var(--text-muted)]">{t("requestsPage.card.riskReasonsTitle", locale)}</p>
												<ul className="mt-0.5 list-disc space-y-0.5 pl-4 text-[var(--text-secondary)]">
													{riskReasons.map((reason) => (
														<li key={reason} data-risk-reason={reason}>{translated(`commandsPage.riskReason.${reason}`, reason)}</li>
													))}
												</ul>
											</div>
										) : null}
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

	const assistantCommands = requests.filter((r) => AI_ORIGINS.has(requestOrigin(r))).length;
	const userCommands = requests.filter((r) => PEOPLE_ORIGINS.has(requestOrigin(r))).length;
	const automationCommands = requests.length - assistantCommands - userCommands;
	const listEmpty = visibleListRequests.length === 0 && !focusedRequest;

	return (
		<PageShell>
			<PageHeader
			eyebrow={t("requestsPage.eyebrow", locale)}
			title={t("requestsPage.title", locale)}
			description={t("requestsPage.desc", locale)}
		>
				{pendingAiOpsCount > 0 ? (
					<ButtonLink href="/ai-ops" size="sm" variant="secondary" data-ai-ops-pending={pendingAiOpsCount}>
						<StatusBadge tone="warning">{pendingAiOpsCount}</StatusBadge>
						{t("requestsPage.aiOps.pending", locale, { count: pendingAiOpsCount })}
					</ButtonLink>
				) : null}
			</PageHeader>
			{/* How approvals work: a note under the header, not text in the action slot. */}
			<Notice tone="info" title={t("requestsPage.workflowNote.title", locale)} className="mb-5">
				{t("requestsPage.workflowNote.desc", locale)}
			</Notice>
			{/* The requester's unconfirmed AI proposals are confirmed in the conversation that made them: a pointer,
			    not a second set of cards that approved the same actions out of their context. */}
			{pendingHostedActionCount > 0 ? (
				<Notice tone="warning" title={t("requestsPage.aiBanner.title", locale)} className="mb-5" data-ai-proposals-banner={pendingHostedActionCount}>
					<div className="flex flex-wrap items-center justify-between gap-3">
						<span>{t("requestsPage.aiBanner.body", locale, { count: pendingHostedActionCount })}</span>
						<ButtonLink
							href={latestProposal?.conversationId ? aiConversationHref(latestProposal.conversationId, latestProposal.id) : "/ai"}
							size="xs"
							variant="secondary"
						>
							{t("requestsPage.aiBanner.open", locale)}
						</ButtonLink>
					</div>
				</Notice>
			) : null}

			<StatGrid cols={4}>
				<StatCard label={t("requestsPage.stat.cmdPending", locale)} value={String(pendingCount)} accent={pendingCount > 0} accentColor="amber" />
				<StatCard label={t("requestsPage.stat.assistant", locale)} value={String(assistantCommands)} accent={assistantCommands > 0} accentColor="cyan" />
				<StatCard label={t("requestsPage.stat.user", locale)} value={String(userCommands)} />
				<StatCard label={t("requestsPage.stat.automation", locale)} value={String(automationCommands)} />
			</StatGrid>

			<div className="space-y-6">
				{requestedId ? (
					<section aria-label={t("requestsPage.focused.title", locale)}>
						{focusedRequest ? (
							<ListPanel
								title={t("requestsPage.focused.title", locale)}
								actions={
									<ButtonLink href={pageUrl({ requestId: null, after: null })} size="sm" variant="secondary">
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
									<ButtonLink href={pageUrl({ requestId: null, after: null })} size="xs" variant="secondary">
										{t("requestsPage.focused.viewAll", locale)}
									</ButtonLink>
								</div>
							</Notice>
						)}
					</section>
				) : null}

				<section aria-label={t("requestsPage.cmd.title", locale)} data-request-tab={tab}>
					<TabNav
						ariaLabel={t("requestsPage.tabs.aria", locale)}
						className="mb-3"
						items={tabs.map((id) => ({
							href: pageUrl({ tab: id, after: null }),
							label: t(`requestsPage.tabs.${id}`, locale),
							active: id === tab,
						}))}
					/>
					<nav aria-label={t("requestsPage.originFilter.aria", locale)} data-origin-filter className="mb-4 flex flex-wrap gap-1.5">
						<OriginChip href={pageUrl({ origin: null, after: null })} selected={origin === null} id="ALL">
							{t("requestsPage.originFilter.all", locale)}
						</OriginChip>
						{ORIGIN_FILTERS.map((id) => (
							<OriginChip key={id} href={pageUrl({ origin: id, after: null })} selected={origin === id} id={id}>
								{t(`requestsPage.originFilter.${id}`, locale)}
							</OriginChip>
						))}
					</nav>
					<ListPanel
						title={t("requestsPage.cmd.title", locale)}
						description={t(`requestsPage.tabs.desc.${tab}`, locale)}
						count={visibleListRequests.length}
						actions={<StatusBadge tone="warning">{t("requestsPage.cmd.scopeBadge", locale)}</StatusBadge>}
						empty={listEmpty ? (
							origin ? (
								<EmptyState text={t("requestsPage.tabs.emptyFiltered", locale)} />
							) : (
								<EmptyState
									title={t(`requestsPage.tabs.empty.${tab}`, locale)}
									text={tab === "my_submissions" || tab === "open" ? t("requestsPage.cmd.emptyHint", locale) : undefined}
									action={(tab === "my_submissions" || tab === "open") && (canReadServers || canReadTemplates) ? (
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
							)
						) : undefined}
						bodyClassName={visibleListRequests.length === 0 ? undefined : "!divide-y-0 space-y-0 bg-transparent p-3"}
						>
						{activeRequests.length > 0 ? (
						<BatchReviewToolbar
							pendingIds={activeRequests.filter(awaitsThisReviewer).map((r) => r.id)}
						>
							{activeRequests.map(renderRequest)}
						</BatchReviewToolbar>
						) : tab !== "history" && visibleListRequests.length > 0 ? <EmptyState text={t("requestsPage.cmd.noActive", locale)} /> : null}
						{handledRequests.length > 0 ? (
							tab === "history" ? (
								<PaginatedList pageSize={20}>{handledRequests.map(renderRequest)}</PaginatedList>
							) : (
								<Disclosure variant="inset" title={t("requestsPage.cmd.history", locale)} count={handledRequests.length}>
									<PaginatedList pageSize={20}>{handledRequests.map(renderRequest)}</PaginatedList>
								</Disclosure>
							)
						) : null}
						{(cursor || nextCursor) && <nav className="flex gap-2 p-3" aria-label={t("common.pagination.label", locale)}>
							{cursor && <ButtonLink href={pageUrl({ after: null })} size="sm" variant="secondary">{t("common.pagination.firstPage", locale)}</ButtonLink>}
							{nextCursor && <ButtonLink href={pageUrl({ after: nextCursor })} size="sm" variant="secondary">{t("common.pagination.next", locale)}</ButtonLink>}
						</nav>}
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

function riskTone(risk: string): BadgeTone {
	switch (risk) {
		case "critical":
			return "danger";
		case "high":
			return "warning";
		case "medium":
			return "amber";
		default:
			return "success";
	}
}

/** Where a request came from, by its recorded origin: a deployment is a deployment, never "AI". */
function OriginBadge({ origin, label }: { origin: string; label: string }) {
	const tone: StatusTone = AI_ORIGINS.has(origin)
		? "accent"
		: origin === "DEPLOYMENT" || origin === "DEPLOYMENT_ROLLBACK"
			? "info"
			: origin === "SCHEDULED_TASK" || origin === "PLAYBOOK"
				? "warning"
				: "neutral";
	return (
		<StatusBadge tone={tone} size="sm" data-origin-badge={origin}>
			{label}
		</StatusBadge>
	);
}

/** A filter chip that is a link: the filter lives in the URL, and the server renders the matching list. */
function OriginChip({ href, selected, id, children }: { href: string; selected: boolean; id: string; children: ReactNode }) {
	return (
		<Link
			href={href}
			data-chip=""
			data-origin-chip={id}
			aria-current={selected ? "true" : undefined}
			className={selected ? "!border-[var(--accent-border)] !bg-[var(--accent-bg)] !text-[var(--accent)]" : undefined}
		>
			{children}
		</Link>
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
