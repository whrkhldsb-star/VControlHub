/**
 * The largest request body a route behind the proxy (`src/proxy.ts`) receives.
 *
 * Next buffers the body of every request its proxy runs on and passes on only
 * the first `experimental.proxyClientMaxBodySize` bytes (next.config.ts sets
 * it to this value; a test keeps the two equal). The rest is dropped without
 * an error, so a route must not accept a declared length above this: it would
 * read a body cut short. Routes that take larger bodies are left out of the
 * proxy matcher and check the session and CSRF token themselves.
 */
export const PROXY_CLIENT_MAX_BODY_BYTES = 34 * 1024 * 1024;
