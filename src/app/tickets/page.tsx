import { requireSession } from "@/lib/auth/require-session";
import { sessionHasPermission } from "@/lib/auth/authorization";
import { listTickets } from "@/lib/ticket/service";
import { PageShell, EmptyState, PageHeader } from "@/components/page-shell";
import { CreateTicketForm } from "./create-ticket-form";
import Link from "next/link";
import { getServerLocale, t, type Locale } from "@/lib/i18n/translations";

export const dynamic = "force-dynamic";

const statusTone: Record<string, string> = {
	OPEN: "border-[var(--color-action-border)]/30 bg-[var(--color-action-bg)]/10 text-[var(--text-primary)]",
	IN_PROGRESS: "border-amber-400/30 bg-amber-400/10 text-amber-100",
	RESOLVED: "border-emerald-400/30 bg-emerald-400/10 text-emerald-100",
	CLOSED: "border-slate-400/30 bg-slate-400/10 text-[var(--text-secondary)]",
};

function priorityLabel(locale: Locale, key: string): string {
	return t(`ticketsPage.priority.${key}`, locale) !== `ticketsPage.priority.${key}` ? t(`ticketsPage.priority.${key}`, locale) : key;
}

function statusLabel(locale: Locale, key: string): string {
	return t(`ticketsPage.status.${key}`, locale) !== `ticketsPage.status.${key}` ? t(`ticketsPage.status.${key}`, locale) : key;
}

export default async function Page() {
	const session = await requireSession("/tickets");
	const canManage = sessionHasPermission(session, "ticket:manage");
	const canCreate = sessionHasPermission(session, "ticket:create");
	const locale = await getServerLocale();
	const tickets = await listTickets(canManage ? undefined : session.userId);
	return (
		<PageShell maxW="max-w-4xl">
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
										<span>{t("ticketsPage.createdAt", locale).replace("{time}", new Date(ticket.createdAt).toLocaleString(locale === "zh" ? "zh-CN" : "en-US"))}</span>
									</div>
								</Link>
					))}
				</div>
			</section>
		</PageShell>
	);
}
