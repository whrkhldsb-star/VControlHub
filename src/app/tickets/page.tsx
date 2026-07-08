import { requireSession } from "@/lib/auth/require-session";
import { sessionHasPermission } from "@/lib/auth/authorization";
import { listTickets } from "@/lib/ticket/service";
import { PageShell, EmptyState, PageHeader } from "@/components/page-shell";
import { CreateTicketForm } from "./create-ticket-form";
import Link from "next/link";
import { toDateLocale } from "@/lib/i18n/locale-format";
import { getServerLocale, t, type Locale } from "@/lib/i18n/translations";

export const dynamic = "force-dynamic";

const statusTone: Record<string, string> = {
	OPEN: "border-[var(--color-action-border)]/30 bg-[var(--color-action-bg)]/10 text-[var(--text-primary)]",
	IN_PROGRESS: "border-[var(--warning-border)] bg-[var(--warning-bg)] text-[var(--warning)]",
	RESOLVED: "border-[var(--success-border)] bg-[var(--success-bg)] text-[var(--success)]",
	CLOSED: "border-[var(--border)] bg-[var(--surface)] text-[var(--text-secondary)]",
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
	const tickets = await listTickets(canManage ? undefined : session.userId);
	return (
		<PageShell maxW="max-w-7xl">
			<PageHeader eyebrow={t("ticketsPage.eyebrow", locale)} title={t("ticketsPage.title", locale)} description={t("ticketsPage.desc", locale)} className="mb-6" />

			{canCreate && <div className="mb-6"><CreateTicketForm locale={locale} /></div>}

			<section data-card className="">
				<div className="border-b border-[var(--border)] px-5 py-4 text-sm font-semibold text-[var(--text-primary)]">{t("ticketsPage.listHeader", locale).replace("{count}", String(tickets.length))}</div>
				<div className="divide-y divide-[var(--border)]">
					{tickets.length === 0 ? <EmptyState text={t("ticketsPage.empty", locale)} /> : tickets.map((ticket) => (
						<Link key={ticket.id} href={`/tickets/${ticket.id}`} className="block px-5 py-4 transition hover:bg-[var(--surface)]/[0.04]"> <div className="flex items-center justify-between gap-3"> <h3 className="text-sm font-medium text-[var(--text-primary)]">{ticket.title}</h3> <div className="flex items-center gap-2"> <span className="text-xs text-[var(--text-muted)]">{priorityLabel(locale, ticket.priority)}</span> <span className={`rounded-full border px-2.5 py-1 text-xs ${statusTone[ticket.status] ?? "border-[var(--border)] text-[var(--text-muted)]"}`}>
											{statusLabel(locale, ticket.status)}
										</span>
									</div>
									</div>
									<p className="mt-1.5 text-xs text-[var(--text-muted)] line-clamp-2">{ticket.description}</p>
									<div className="mt-2 flex flex-wrap gap-x-3 text-xs text-[var(--text-muted)]">
										{ticket.creator && <span>{t("ticketsPage.creator", locale).replace("{name}", ticket.creator.displayName || ticket.creator.username)}</span>}
										{ticket.assignee && <span>{t("ticketsPage.assignee", locale).replace("{name}", ticket.assignee.displayName || ticket.assignee.username)}</span>}
										<span>{t("ticketsPage.createdAt", locale).replace("{time}", new Date(ticket.createdAt).toLocaleString(toDateLocale(locale)))}</span>
									</div>
								</Link>
					))}
				</div>
			</section>
		</PageShell>
	);
}
