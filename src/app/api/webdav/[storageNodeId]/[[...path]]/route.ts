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
  handleWebDavMkcol,
  handleWebDavMove,
  handleWebDavOptions,
  handleWebDavPropFind,
  handleWebDavPut,
  normalizeWebDavRelativePath,
  type WebDavContext,
} from "@/lib/webdav/handler";
import { createLogger } from "@/lib/logging";
import { getErrorMessage } from "@/lib/http/error-message";
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

  const relativePath = normalizeWebDavRelativePath(params.path);
  const requestUrl = new URL(request.url);
  const ctx: WebDavContext = {
    session: auth.session,
    storageNodeId: params.storageNodeId,
    relativePath,
    requestUrl,
    rangeHeader: request.headers.get("range"),
  };

  try {
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
      default:
        return new Response("Method Not Allowed", {
          status: 405,
          headers: {
            Allow:
              "OPTIONS, PROPFIND, GET, HEAD, PUT, DELETE, MKCOL, MOVE, COPY",
          },
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

async function withParams(
  request: Request,
  context: { params: Promise<RouteParams> },
) {
  return dispatch(request, await context.params);
}

export const GET = withParams;
export const HEAD = withParams;
export const PUT = withParams;
export const DELETE = withParams;
export const POST = withParams;
export const OPTIONS = withParams;
// guardMode: public (WebDAV Basic auth via authenticateWebDavRequest)
