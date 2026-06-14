/**
 * AI service — barrel module (R28 god-file split).
 *
 * The previous 631-line god-file has been split into:
 *   - `./service-crud`      — provider + conversation CRUD + input types + helpers
 *   - `./service-runtime`   — model fetching + chat-completion
 *   - `./service-serialize` — DTO serializers (Date → ISO string)
 *   - `./provider-http`     — low-level HTTP adapter (R12 extraction)
 *
 * Existing call sites import from `@/lib/ai/service` and re-export everything
 * from this barrel so no caller migration is required.
 */
export * from "./service-crud";
export * from "./service-runtime";
export * from "./service-serialize";
