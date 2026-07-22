import { requirePagePermission } from "@/lib/auth/page-guard";
import {
  listProviders,
  listConversations,
  serializeConversationListItem,
  serializeProvider,
} from "@/lib/ai/service";
import { AiClient } from "./ai-client";

export const dynamic = "force-dynamic";

export default async function AiPage() {
  // Match chat APIs: require ai:chat at the page boundary (not bare session).
  const session = await requirePagePermission("ai:chat", { redirectTo: "/ai" });
  const providers = await listProviders(session.userId);
  const conversations = await listConversations(session.userId);

  return (
    <AiClient
      // serializeProvider masks apiKey ciphertext before it reaches RSC → client HTML.
      initialProviders={providers.map((p) => ({
        ...serializeProvider(p),
        // Provider UI expects settings as a JSON string, not Prisma JsonValue.
        settings: String(p.settings ?? "{}"),
        // Client Provider type omits createdBy; keep wire shape aligned.
        defaultModel: p.defaultModel ?? "",
      }))}
      initialConversations={conversations.map(serializeConversationListItem)}
    />
  );
}
