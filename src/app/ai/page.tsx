import { firstSearchParams } from "@/lib/http/first-search-param";
import { sessionHasPermission } from "@/lib/auth/authorization";
import { requirePagePermission } from "@/lib/auth/page-guard";
import { serverTeamWhere } from "@/lib/auth/team-scope";
import { DEFAULT_FULL_AUTO_TTL_MINUTES, MAX_FULL_AUTO_TTL_MINUTES } from "@/lib/ai/execution-mode";
import { resolveEffectivePolicyForOrigin } from "@/lib/command/approval-policy";
import { getApprovalPolicySettings } from "@/lib/command/approval-policy-settings";
import { prisma } from "@/lib/db";
import {
  listProviders,
  listChatProviders,
  listConversations,
  serializeConversationListItem,
  serializeProvider,
} from "@/lib/ai/service";
import type { AiCapabilities } from "./ai-automation-mode";
import type { AiServerOption } from "./ai-types";
import { AiClient } from "./ai-client";

export const dynamic = "force-dynamic";

/** Servers listed in the pinned-server picker; the search narrows them. */
const PINNABLE_SERVER_LIMIT = 500;

export default async function AiPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string | string[]; server?: string | string[]; c?: string | string[] }>;
}) {
  // Match chat APIs: require ai:chat at the page boundary (not bare session).
  const session = await requirePagePermission("ai:chat", { redirectTo: "/ai" });
  const canManageProviders = sessionHasPermission(session, "ai:manage");
  const canReadServers = sessionHasPermission(session, "server:read");
  const params = firstSearchParams(await searchParams);
  const requestedServer = params.server?.trim().slice(0, 64) || null;
  const requestedConvId = params.c?.trim().slice(0, 64) || null;
  const [providers, conversations, policies, servers] = await Promise.all([
    canManageProviders
      ? listProviders(session.userId).then((rows) => rows.map((p) => ({
          ...serializeProvider(p), settings: JSON.stringify(p.settings ?? {}), defaultModel: p.defaultModel ?? "",
        })))
      : listChatProviders(session.userId),
    listConversations(session),
    getApprovalPolicySettings(),
    // The servers a pin may name: those PATCH /api/ai/conversations/[id] accepts (enabled, reachable for this
    // account). Only with server:read — without it the page lists no inventory.
    canReadServers
      ? prisma.server.findMany({
          where: { enabled: true, AND: [serverTeamWhere(session), serverTeamWhere(session, "connect")] },
          orderBy: [{ name: "asc" }, { id: "asc" }],
          take: PINNABLE_SERVER_LIMIT,
          select: { id: true, name: true, host: true },
        })
      : Promise.resolve([] as AiServerOption[]),
  ]);
  // Resolve deep-linked ?server= and ?c= even when outside the initial bounded picker/sidebar page.
  const allServers = [...servers];
  if (requestedServer && canReadServers && !allServers.some((server) => server.id === requestedServer)) {
    const targetedServer = await prisma.server.findFirst({
      where: {
        id: requestedServer,
        enabled: true,
        AND: [serverTeamWhere(session), serverTeamWhere(session, "connect")],
      },
      select: { id: true, name: true, host: true },
    });
    if (targetedServer) allServers.push(targetedServer);
  }
  const allConversations = [...conversations];
  if (requestedConvId && !allConversations.some((conv) => conv.id === requestedConvId)) {
    const targetedConv = await prisma.aiConversation.findFirst({
      where: {
        id: requestedConvId,
        createdBy: session.userId,
        teamId: session.currentTeamId ?? null,
      },
      include: { provider: { select: { id: true, name: true, type: true } } },
    });
    if (targetedConv) allConversations.unshift(targetedConv as (typeof allConversations)[number]);
  }
  // "Ask AI" deep links (server cards, alert pages…) prefill the composer via
  // ?q=. Bounded like any user-supplied string rendered back into the page.
  const draft = params.q?.slice(0, 2000) ?? "";
  // ?server=<id> (aiServerHref) starts a conversation pinned to that server — when this account may reach it.
  const initialPinnedServerId = requestedServer && allServers.some((server) => server.id === requestedServer) ? requestedServer : null;

  const capabilities: AiCapabilities = {
    canAuto: sessionHasPermission(session, "ai:action:auto"),
    canFullAuto: sessionHasPermission(session, "ai:action:full-auto"),
    canExecute: sessionHasPermission(session, "command:execute"),
    canApprove: sessionHasPermission(session, "command:approve"),
    canReadServers,
    aiMaxAutomationMode: policies.aiMaxAutomationMode,
    selfReviewPolicy: policies.commandSelfReview,
    isPlatformAdmin: sessionHasPermission(session, "team:manage"),
    aiCommandPolicy: resolveEffectivePolicyForOrigin(policies, "AI_CHAT"),
    fullAutoAllowCritical: policies.aiFullAutoAllowCritical,
    maxFullAutoTtlMinutes: MAX_FULL_AUTO_TTL_MINUTES,
    defaultFullAutoTtlMinutes: DEFAULT_FULL_AUTO_TTL_MINUTES,
  };

  return (
    <AiClient
      canManageProviders={canManageProviders}
      initialProviders={providers}
      initialConversations={allConversations.map(serializeConversationListItem)}
      initialDraft={draft}
      capabilities={capabilities}
      servers={allServers.map((server) => ({ id: server.id, name: server.name, host: server.host }))}
      initialPinnedServerId={initialPinnedServerId}
      pinnedServerRejected={Boolean(requestedServer) && !initialPinnedServerId}
    />
  );
}
