/**
 * AI service — barrel module (R28 god-file split).
 *
 * The previous 631-line god-file has been split into:
 *   - `./service-crud`      — provider + conversation CRUD + input types + helpers
 *   - `./service-runtime`   — model fetching + chat-completion
 *   - `./service-serialize` — DTO serializers (Date → ISO string)
 *   - `./provider-http`     — low-level HTTP adapter (R12 extraction)
 *   - `./dto`               — TR-039: pure wire-shape types (no Prisma, no DB)
 *
 * Existing call sites import from `@/lib/ai/service` and re-export everything
 * from this barrel so no caller migration is required. The DTO types are
 * re-exported here as well so server-side call sites that only need the
 * wire shape (e.g. typed API responses) can keep importing from the
 * barrel. New client code should import the DTO types from
 * `@/lib/ai/dto` directly to avoid pulling in the service module.
 */
export * from "./service-crud";
export * from "./service-runtime";
export * from "./service-serialize";
export type {
  AiConversationDto,
  AiConversationListItemDto,
  AiMessageDto,
  AiProviderDto,
  AiProviderRowDto,
} from "./dto";
