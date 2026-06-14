/**
 * AI DTO boundary (TR-039).
 *
 * The AI service barrel (`@/lib/ai/service`) pulls in Prisma, crypto,
 * runtime settings and the storage helper to serve its CRUD + chat
 * surfaces. None of that should reach a client component.
 *
 * The wire shapes produced by the `serializeProvider` /
 * `serializeConversation` / `serializeConversationListItem` helpers in
 * `service-serialize.ts` are the contract the `/api/ai/*` routes and the
 * AI page emit. They are pure-data (Date → ISO string, apiKey masked) and
 * safe to import from a client bundle.
 *
 * `service.ts` re-exports the DTO types so existing call sites
 * `from "@/lib/ai/service"` keep working unchanged. New client code
 * should import the wire DTO types from this module.
 *
 * Pure types only — no runtime side effects, no Prisma, no DB.
 */

/**
 * Provider row as it appears on the wire — output of
 * `serializeProvider`. The `apiKey` field is masked to first 8 / last 4
 * characters by the serializer; the `settings` field comes back as
 * `Prisma.JsonValue` and is typically rendered as a JSON string on the
 * client. Date fields are emitted as ISO 8601 strings.
 */
export type AiProviderDto = {
  id: string;
  name: string;
  type: string;
  apiKey: string;
  baseUrl: string;
  defaultModel: string | null;
  availableModels: string;
  isDefault: boolean;
  enabled: boolean;
  settings: unknown;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
};

/**
 * Conversation summary as it appears in list endpoints — output of
 * `serializeConversationListItem`. Carries a slimmed-down provider
 * (`{ id, name, type }`) so the client can render the badge without an
 * extra round-trip. Date fields are ISO strings.
 */
export type AiConversationListItemDto = {
  id: string;
  title: string;
  providerId: string;
  model: string;
  systemPrompt: string | null;
  temperature: number | null;
  maxTokens: number | null;
  topP: number | null;
  frequencyPenalty: number | null;
  presencePenalty: number | null;
  enableVision: boolean;
  hostingEnabled: boolean;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  provider: { id: string; name: string; type: string } | null;
};

/**
 * Single chat message as it appears inside a full conversation. The
 * `imageUrls` field is a `Prisma.JsonValue` (array of strings) and the
 * `createdAt` field is serialised to an ISO string.
 */
export type AiMessageDto = {
  id: string;
  conversationId: string;
  role: string;
  content: string;
  reasoningContent: string | null;
  imageUrls: unknown;
  model: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  latencyMs: number | null;
  createdAt: string;
};

/**
 * Full conversation as it appears on the wire — output of
 * `serializeConversation`. Carries the embedded provider row and the
 * ordered message list. The provider `settings` and `apiKey` follow the
 * same masking rules as the list endpoint, but the field set is the full
 * `AiProviderDto` so the client can edit / display every property.
 */
export type AiConversationDto = {
  id: string;
  title: string;
  providerId: string;
  model: string;
  systemPrompt: string | null;
  temperature: number | null;
  maxTokens: number | null;
  topP: number | null;
  frequencyPenalty: number | null;
  presencePenalty: number | null;
  enableVision: boolean;
  hostingEnabled: boolean;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  provider: AiProviderDto | null;
  messages: AiMessageDto[];
};

/**
 * Provider row as it lives inside the unserialised service module. The
 * Date fields are real `Date` instances; the `apiKey` is the encrypted
 * blob from the database. The DTO layer wraps this with
 * `AiProviderDto` for client consumption; the input type is kept here so
 * service.ts can keep its public type surface for server-side callers
 * that don't need the wire shape.
 */
export type AiProviderRowDto = {
  id: string;
  name: string;
  type: string;
  apiKey: string;
  baseUrl: string;
  defaultModel: string | null;
  availableModels: string;
  isDefault: boolean;
  enabled: boolean;
  settings: unknown;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
};
