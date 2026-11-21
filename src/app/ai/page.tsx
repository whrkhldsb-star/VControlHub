import { firstSearchParams } from "@/lib/http/first-search-param";
import { sessionHasPermission } from "@/lib/auth/authorization";
import { requirePagePermission } from "@/lib/auth/page-guard";
import {
  listProviders,
  listChatProviders,
  listConversations,
  serializeConversationListItem,
  serializeProvider,
} from "@/lib/ai/service";
import { AiClient } from "./ai-client";

export const dynamic = "force-dynamic";

export default async function AiPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  // Match chat APIs: require ai:chat at the page boundary (not bare session).
  const session = await requirePagePermission("ai:chat", { redirectTo: "/ai" });
  const canManageProviders = sessionHasPermission(session, "ai:manage");
  const providers = canManageProviders
    ? (await listProviders(session.userId)).map((p) => ({
        ...serializeProvider(p), settings: JSON.stringify(p.settings ?? {}), defaultModel: p.defaultModel ?? "",
      }))
    : await listChatProviders(session.userId);
  const conversations = await listConversations(session);
  // "Ask AI" deep links (server cards, alert pages…) prefill the composer via
  // ?q=. Bounded like any user-supplied string rendered back into the page.
  const draft = firstSearchParams(await searchParams).q?.slice(0, 2000) ?? "";

  return (
    <AiClient
      canManageProviders={canManageProviders}
      initialProviders={providers}
      initialConversations={conversations.map(serializeConversationListItem)}
      initialDraft={draft}
    />
  );
}
