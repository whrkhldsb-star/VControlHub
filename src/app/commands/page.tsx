import { requirePagePermission } from "@/lib/auth/page-guard";
import { sessionHasPermission } from "@/lib/auth/authorization";
import { serverTeamWhere } from "@/lib/auth/team-scope";
import { getCommandRequestDetailForViewer } from "@/lib/command/service";
import { prisma } from "@/lib/db";
import { NotFoundError } from "@/lib/errors";
import { firstSearchParams } from "@/lib/http/first-search-param";
import { OPERATION_TARGET_SELECT, operationTargetAvailability } from "@/lib/server/availability";
import { getSnippet, snippetViewer } from "@/lib/snippet/service";
import { STARTER_SNIPPETS } from "@/lib/snippet/starters";
import { PageHeader, PageShell } from "@/components/page-shell";
import { Notice } from "@/components/ui-primitives";
import { getServerLocale, t } from "@/lib/i18n/translations";
import { DirectCommandComposer, type CommandDraft, type CommandTargetOption } from "./direct-command-composer";

export const dynamic = "force-dynamic";

export default async function CommandsPage({ searchParams }: { searchParams?: Promise<Record<string, string | string[] | undefined>> }) {
	const session = await requirePagePermission("command:create", { redirectTo: "/commands" });
	const locale = await getServerLocale();
	const tr = (key: string) => t(key, locale);
	const header = <PageHeader eyebrow={tr("commandsPage.eyebrow")} title={tr("commandsPage.title")} description={tr("commandsPage.desc")} />;
	if (!sessionHasPermission(session, "server:read")) return <PageShell>{header}<Notice tone="warning">{tr("commandsPage.noServerRead")}</Notice></PageShell>;
	const { serverId, snippetId, fromRequestId } = firstSearchParams(await searchParams);
	const canRead = sessionHasPermission(session, "command:read");
	const canReadSnippets = sessionHasPermission(session, "snippet:manage");
	const rows = await prisma.server.findMany({ where: { AND: [serverTeamWhere(session), serverTeamWhere(session, "connect")] }, orderBy: [{ name: "asc" }, { id: "asc" }],
		select: { id: true, name: true, host: true, enabled: true, ...OPERATION_TARGET_SELECT } });
	const servers = rows.map<CommandTargetOption>(row => {
		const { available, reason } = operationTargetAvailability(row);
		return { id: row.id, name: row.name, host: row.host, operatingSystem: row.operatingSystem === "WINDOWS" ? "WINDOWS" : "LINUX", available: row.enabled && available,
			unavailableReason: !row.enabled ? tr("serverOverviewCard.disabled") : reason ? tr(reason === "setup-incomplete" ? "serversPage.command.nodeSetupIncomplete" : "serversPage.command.nodeRecentlyOffline") : undefined };
	});
	let initial: CommandDraft = { serverIds: serverId ? [serverId] : [] };
	let notice: string | undefined;
	if (fromRequestId) {
		const detail = canRead ? await getCommandRequestDetailForViewer(session, fromRequestId) : null;
		if (!detail || detail.commandHidden) notice = tr(detail?.commandHidden ? "commandsPage.hidden" : "commandsPage.noRequest");
		else initial = { title: detail.title, command: detail.command, reason: detail.reason ?? "", serverIds: detail.targets.flatMap(target => target.server ? [target.server.id] : []) };
	} else if (snippetId) {
		const starter = STARTER_SNIPPETS.find(s => s.id === snippetId);
		if (starter) initial = { ...initial, fromSnippet: true, title: tr(starter.titleKey), command: starter.content };
		else {
			try {
				const snippet = canReadSnippets ? await getSnippet(snippetId, snippetViewer(session)) : null;
				if (snippet) initial = { ...initial, fromSnippet: true, title: snippet.title, command: snippet.content };
				else notice = tr("commandsPage.noSnippet");
			} catch (err) { if (!(err instanceof NotFoundError)) throw err; notice = tr("commandsPage.noSnippet"); }
		}
	}
	return <PageShell>{header}{notice && <Notice tone="warning" className="mb-3">{notice}</Notice>}
		<DirectCommandComposer key={JSON.stringify([session.userId, session.currentTeamId, serverId, snippetId, fromRequestId, notice])} servers={servers} initial={initial}
			allowDirectExecution={sessionHasPermission(session, "command:execute")} canReadRequests={canRead} canReadSavedSnippets={canReadSnippets} canReadTasks={sessionHasPermission(session, "task:read")} />
	</PageShell>;
}
