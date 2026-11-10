/**
 * WebDAV endpoint:
 *   /api/webdav/[storageNodeId]
 *   /api/webdav/[storageNodeId]/[...path]
 *
 * Non-standard WebDAV verbs (PROPFIND/MKCOL/MOVE/COPY/...) are rewritten by
 * the custom Node server to POST + X-HTTP-Method-Override.
 */
import { AppError, AuthError } from "@/lib/errors";
import {
  authenticateWebDavRequest,
  webDavUnauthorizedResponse,
} from "@/lib/webdav/auth";
import {
  handleWebDavCopy,
  handleWebDavDelete,
  handleWebDavGetHead,
  handleWebDavLock,
  handleWebDavMkcol,
  handleWebDavMove,
  handleWebDavOptions,
  handleWebDavPropFind,
  handleWebDavPropPatch,
  handleWebDavPut,
  handleWebDavUnlock,
  normalizeWebDavRelativePath,
  WEBDAV_ALLOW_HEADER,
  type WebDavContext,
} from "@/lib/webdav/handler";
import { createLogger } from "@/lib/logging";
import { getErrorMessage } from "@/lib/http/error-message";
import { isRequestHttps } from "@/lib/http/request-https";
import { withBaseSecurityHeaders } from "@/lib/http/security-headers";
import { WEBDAV_LIMIT, withRateLimit } from "@/lib/http/rate-limit-presets";

const logger = createLogger("webdav:route");

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type RouteParams = { storageNodeId: string; path?: string[] };

function effectiveMethod(request: Request): string {
  const override = request.headers.get("x-http-method-override");
  if (override && override.trim()) return override.trim().toUpperCase();
  return request.method.toUpperCase();
}

async function dispatch(
  request: Request,
  params: RouteParams,
): Promise<Response> {
  const method = effectiveMethod(request);

  if (method === "OPTIONS") {
    return handleWebDavOptions();
  }

  // Before authentication on purpose: this route verifies its own token and is
  // exempt from the proxy's bearer checks, so an anonymous caller would
  // otherwise get one free token lookup per request.
  const rateLimit = await withRateLimit(request, WEBDAV_LIMIT);
  if (!rateLimit.allowed) {
    return new Response("Too Many Requests", {
      status: 429,
      headers: {
        "Retry-After": String(Math.max(1, Math.ceil(rateLimit.retryAfterMs / 1000))),
        "Content-Type": "text/plain; charset=utf-8",
      },
    });
  }

  let auth;
  try {
    auth = await authenticateWebDavRequest(request, method);
  } catch (error) {
    if (error instanceof AuthError) {
      return webDavUnauthorizedResponse();
    }
    throw error;
  }

  // Inside the try: a path it refuses (.., control characters, too long) is
  // the client's 400, not an unhandled 500.
  let relativePath = "";
  try {
    // Next has percent-decoded the catch-all segments already.
    relativePath = normalizeWebDavRelativePath(params.path, { alreadyDecoded: true });
    const ctx: WebDavContext = {
      session: auth.session,
      storageNodeId: params.storageNodeId,
      relativePath,
      requestUrl: new URL(request.url),
      rangeHeader: request.headers.get("range"),
    };
    switch (method) {
      case "PROPFIND":
        return await handleWebDavPropFind(ctx, request.headers.get("depth"));
      case "GET":
        return await handleWebDavGetHead(ctx, "GET");
      case "HEAD":
        return await handleWebDavGetHead(ctx, "HEAD");
      case "PUT":
        return await handleWebDavPut(ctx, request);
      case "DELETE":
        return await handleWebDavDelete(ctx);
      case "MKCOL":
        return await handleWebDavMkcol(ctx);
      case "MOVE":
        return await handleWebDavMove(ctx, request);
      case "COPY":
        return await handleWebDavCopy(ctx, request);
      case "LOCK":
        return await handleWebDavLock(ctx, request);
      case "UNLOCK":
        return await handleWebDavUnlock();
      case "PROPPATCH":
        return await handleWebDavPropPatch(ctx);
      default:
        return new Response("Method Not Allowed", {
          status: 405,
          headers: { Allow: WEBDAV_ALLOW_HEADER },
        });
    }
  } catch (error) {
    const message = getErrorMessage(error, "WebDAV error");
    // All expected handler failures are typed; unknown failures stay 500.
    const status = error instanceof AppError ? error.status : 500;

    if (status === 401) return webDavUnauthorizedResponse();

    logger.warn("webdav request failed", {
      method,
      storageNodeId: params.storageNodeId,
      path: relativePath,
      status,
      error: message,
    });

    return new Response(error instanceof AppError && status < 500 ? message : "Internal Server Error", {
      status,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }
}

/**
 * The proxy does not run on this route (its matcher leaves `/api/webdav` out:
 * Next would buffer every PUT body and pass on only its first megabytes), so
 * the response headers it adds everywhere else are added here. A handler's own
 * value is kept, and a file GET carries its own `sandbox` policy.
 */
async function withParams(
  request: Request,
  context: { params: Promise<RouteParams> },
) {
  return withBaseSecurityHeaders(await dispatch(request, await context.params), {
    https: isRequestHttps(request),
  });
}

export const GET = withParams;
export const HEAD = withParams;
export const PUT = withParams;
export const DELETE = withParams;
export const POST = withParams;
export const OPTIONS = withParams;
// guardMode: public (WebDAV Basic auth via authenticateWebDavRequest)
