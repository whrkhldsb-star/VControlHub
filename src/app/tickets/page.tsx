import { requireSession } from "@/lib/auth/require-session";
import { sessionHasPermission } from "@/lib/auth/authorization";
import { listTickets } from "@/lib/ticket/service";
import { PageShell, EmptyState, PageHeader, StatCard } from "@/components/page-shell";
import { CreateTicketForm } from "./create-ticket-form";
import { listServerProfiles } from "@/lib/server/service-profiles";
import Link from "next/link";
import { toDateLocale } from "@/lib/i18n/locale-format";
import { getServerLocale, t, type Locale } from "@/lib/i18n/translations";

export const dynamic = "force-dynamic";

const statusTone: Record<string, string> = {
	OPEN: "border-[var(--accent-border)] bg-[var(--accent-bg)] text-[var(--accent)]",
	IN_PROGRESS: "border-[var(--warning-border)] bg-[var(--warning-bg)] text-[var(--warning)]",
	RESOLVED: "border-[var(--success-border)] bg-[var(--success-bg)] text-[var(--success)]",
	CLOSED: "border-[var(--border)] bg-[var(--surface-elevated)] text-[var(--text-secondary)]",
};

const priorityTone: Record<string, string> = {
	LOW: "text-[var(--text-muted)]",
	NORMAL: "text-[var(--text-secondary)]",
	HIGH: "text-[var(--warning)]",
	URGENT: "text-[var(--danger)]",
};

function prettyKey(key: string): string {
	return key.replace(/_/g, " ").toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
}

function priorityLabel(locale: Locale, key: string): string {
	const translated = t(`ticketsPage.priority.${key}`, locale);
	return translated !== `ticketsPage.priority.${key}` ? translated : prettyKey(key);
}

function statusLabel(locale: Locale, key: string): string {
	const translated = t(`ticketsPage.status.${key}`, locale);
	return translated !== `ticketsPage.status.${key}` ? translated : prettyKey(key);
}

export default async function Page() {
	const session = await requireSession("/tickets");
	const canManage = sessionHasPermission(session, "ticket:manage");
	const canCreate = sessionHasPermission(session, "ticket:create");
	const locale = await getServerLocale();
	const servers = await listServerProfiles();
	const tickets = await listTickets(canManage ? { session } : { userId: session.userId, session });

	const openCount = tickets.filter((ticket) => ticket.status === "OPEN").length;
	const progressCount = tickets.filter((ticket) => ticket.status === "IN_PROGRESS").length;
	const resolvedCount = tickets.filter((ticket) => ticket.status === "RESOLVED" || ticket.status === "CLOSED").length;
	const urgentCount = tickets.filter((ticket) => ticket.priority === "URGENT" || ticket.priority === "HIGH").length;

	return (
		<PageShell maxW="max-w-7xl">
			<PageHeader
				eyebrow={t("ticketsPage.eyebrow", locale)}
				title={t("ticketsPage.title", locale)}
				description={t("ticketsPage.desc", locale)}
				className="mb-6"
			/>

			<section className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
				<StatCard label={t("ticketsPage.status.OPEN", locale)} value={String(openCount)} accent={openCount > 0} accentColor="cyan" />
				<StatCard label={t("ticketsPage.status.IN_PROGRESS", locale)} value={String(progressCount)} accent={progressCount > 0} accentColor="amber" />
				<StatCard label={t("ticketsPage.status.RESOLVED", locale)} value={String(resolvedCount)} accent={resolvedCount > 0} accentColor="emerald" />
				<StatCard label={priorityLabel(locale, "HIGH")} value={String(urgentCount)} accent={urgentCount > 0} accentColor="rose" />
			</section>

			{canCreate && (
				<div className="mb-6">
					<CreateTicketForm locale={locale} servers={servers.map((s: { id: string; name: string; host: string }) => ({ id: s.id, name: s.name, host: s.host }))} />
				</div>
			)}

			<section data-card className="overflow-hidden !p-0">
				<div className="flex items-center justify-between gap-3 border-b border-[var(--border)] px-5 py-4">
					<div>
						<div className="text-sm font-semibold text-[var(--text-primary)]">
							{t("ticketsPage.listHeader", locale).replace("{count}", String(tickets.length))}
						</div>
						<p className="mt-0.5 text-xs text-[var(--text-muted)]">
							{canManage ? t("ticketsPage.desc", locale) : t("ticketsPage.listHeader", locale).replace("{count}", String(tickets.length))}
						</p>
					</div>
					<span className="rounded-full border border-[var(--border)] bg-[var(--surface-elevated)] px-2.5 py-1 text-[11px] font-medium text-[var(--text-secondary)]">
						{tickets.length}
					</span>
				</div>
				<div className="divide-y divide-[var(--border-subtle)]">
					{tickets.length === 0 ? (
						<EmptyState text={t("ticketsPage.empty", locale)} />
					) : (
						tickets.map((ticket) => (
							<Link
								key={ticket.id}
								href={`/tickets/${ticket.id}`}
								className="block px-5 py-4 transition hover:bg-[var(--surface-hover)]"
							>
								<div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
									<div className="min-w-0 flex-1">
										<div className="flex flex-wrap items-center gap-2">
											<h3 className="truncate text-sm font-semibold text-[var(--text-primary)]">{ticket.title}</h3>
											<span className={`text-[11px] font-semibold uppercase tracking-[0.08em] ${priorityTone[ticket.priority] ?? "text-[var(--text-muted)]"}`}>
												{priorityLabel(locale, ticket.priority)}
											</span>
										</div>
										<p className="mt-1.5 line-clamp-2 text-xs leading-5 text-[var(--text-muted)]">{ticket.description}</p>
										<div className="mt-2.5 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-[var(--text-muted)]">
											{ticket.creator && (
												<span>{t("ticketsPage.creator", locale).replace("{name}", ticket.creator.displayName || ticket.creator.username)}</span>
											)}
											{ticket.assignee && (
												<span>{t("ticketsPage.assignee", locale).replace("{name}", ticket.assignee.displayName || ticket.assignee.username)}</span>
											)}
											<span>
												{t("ticketsPage.createdAt", locale).replace(
													"{time}",
													new Date(ticket.createdAt).toLocaleString(toDateLocale(locale)),
												)}
											</span>
										</div>
									</div>
									<span className={`shrink-0 rounded-full border px-2.5 py-1 text-xs font-medium ${statusTone[ticket.status] ?? "border-[var(--border)] text-[var(--text-muted)]"}`}>
										{statusLabel(locale, ticket.status)}
									</span>
								</div>
							</Link>
						))
					)}
				</div>
			</section>
		</PageShell>
	);
}
