# Browser request policy

Use `api` / `apiRequest` from `src/lib/http/api-client.ts`, or the compatible `csrfFetch` wrapper, for authenticated browser API requests. Use `raw: true` when consumers intentionally handle Response status/body, binary or text themselves; otherwise non-2xx responses become ApiError.

- CSRF is injected only for same-origin mutations; external targets have that header removed.
- Requests carrying CSRF reject redirects instead of forwarding the header off-origin.
- Preserve AbortSignal; effect cleanup cancels work and ignores obsolete results.
- ArrayBuffer uploads retain application/octet-stream and are not JSON encoded.
- Search failures are visible rather than disguised as an empty successful result.
- Public share-password authorization remains native fetch intentionally: it is session-independent, password-gated, rate-limited, and exchanges a short-lived HttpOnly token-bound ticket. It does not use logged-in CSRF semantics.
- Server-side outbound adapters, provider fixtures, service workers and external/presigned downloads are not browser session API calls and are reviewed separately.

Migrated consumers: media/storage chunk PUTs, global search, API docs, server monitor, VPS backup reads and text preview. Regression tests cover client CSRF origin/redirect boundaries, binary uploads and representative UI cancellation/error flows.
