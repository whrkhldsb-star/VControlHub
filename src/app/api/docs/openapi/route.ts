/**
 * OpenAPI/Swagger spec generator — produces locale-aware spec.
 * GET /api/docs/openapi
 */
import { NextResponse } from "next/server";

import { withApiRoute } from "@/lib/http/api-guard";
import { t } from "@/lib/i18n/translations";
import { getServerLocale } from "@/lib/i18n/server-locale";
import routeCatalog from "../../../../../docs/route-catalog.json";

type TFunction = (key: string, vars?: Record<string, string | number>) => string;

type CatalogRoute = {
  path: string;
  methods: string[];
  guardMode: string;
  declaredPermissions: string[];
};

type OpenApiOperation = Record<string, unknown>;
type OpenApiPathItem = Record<string, OpenApiOperation>;

function toOpenApiPath(catalogPath: string): string {
  return catalogPath
    .replace(/^\/api/, "")
    .replace(/\[\[\.\.\.([^\]]+)\]\]/g, "{$1}")
    .replace(/\[\.\.\.([^\]]+)\]/g, "{$1}")
    .replace(/\[([^\]]+)\]/g, "{$1}") || "/";
}

function generatedTag(path: string): string {
  const segment = path.split("/").filter(Boolean)[0] ?? "system";
  return segment
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function generatedOperation(
  route: CatalogRoute,
  method: string,
  path: string,
  tr: TFunction,
): OpenApiOperation {
  const permissions = route.declaredPermissions;
  const security = path.startsWith("/webdav/")
    ? [{ basicAuth: [] }]
    : path.startsWith("/itsm/inbound/")
      ? [{ webhookSignature: [] }]
      : route.guardMode === "public" || route.guardMode === "login"
        ? []
        : [{ cookieAuth: [] }];
  const authDescription = path.startsWith("/webdav/")
    ? tr("openapiSpec.generated.basicAuth")
    : path.startsWith("/itsm/inbound/")
      ? tr("openapiSpec.generated.webhookSignature")
      : security.length === 0
        ? tr("openapiSpec.generated.routeCredential")
        : tr("openapiSpec.generated.authenticated");
  const parameters = Array.from(path.matchAll(/\{([^}]+)\}/g), ([, name]) => ({
    name,
    in: "path",
    required: true,
    schema: { type: "string" },
  }));
  return {
    tags: [generatedTag(path)],
    summary: `${method} ${path}`,
    description: permissions.length > 0
      ? tr("openapiSpec.generated.permissions", { permissions: permissions.join(", ") })
      : authDescription,
    security,
    ...(parameters.length > 0 ? { parameters } : {}),
    responses: {
      "2XX": { description: tr("openapiSpec.generated.success") },
      "400": { description: tr("openapiSpec.generated.badRequest") },
      "401": { description: tr("openapiSpec.generated.unauthorized") },
      "403": { description: tr("openapiSpec.generated.forbidden") },
    },
    "x-vcontrolhub-permissions": permissions,
  };
}

function buildCatalogPaths(
  detailedPaths: Record<string, OpenApiPathItem>,
  tr: TFunction,
): Record<string, OpenApiPathItem> {
  const paths: Record<string, OpenApiPathItem> = {};
  for (const route of routeCatalog.apiRoutes as CatalogRoute[]) {
    const path = toOpenApiPath(route.path);
    const item: OpenApiPathItem = {};
    for (const method of route.methods) {
      const key = method.toLowerCase();
      item[key] = detailedPaths[path]?.[key] ?? generatedOperation(route, method, path, tr);
    }
    paths[path] = item;
  }
  return paths;
}

function buildOpenApiSpec(t: TFunction) {
  return {
    openapi: "3.0.3",
    info: {
      title: t("openapiSpec.info.title"),
      description: t("openapiSpec.info.description"),
      version: "2.0.0",
      contact: { name: t("openapiSpec.info.contact.name") },
    },
    servers: [{ url: "/api", description: t("openapiSpec.info.serverDescription") }],
    tags: [
      { name: t("openapiSpec.tags.auth.name"), description: t("openapiSpec.tags.auth.description") },
      { name: t("openapiSpec.tags.servers.name"), description: t("openapiSpec.tags.servers.description") },
      { name: t("openapiSpec.tags.files.name"), description: t("openapiSpec.tags.files.description") },
      { name: t("openapiSpec.tags.downloads.name"), description: t("openapiSpec.tags.downloads.description") },
      { name: t("openapiSpec.tags.imageBed.name"), description: t("openapiSpec.tags.imageBed.description") },
      { name: t("openapiSpec.tags.docker.name"), description: t("openapiSpec.tags.docker.description") },
      { name: t("openapiSpec.tags.monitoring.name"), description: t("openapiSpec.tags.monitoring.description") },
      { name: t("openapiSpec.tags.users.name"), description: t("openapiSpec.tags.users.description") },
      { name: t("openapiSpec.tags.audit.name"), description: t("openapiSpec.tags.audit.description") },
      { name: t("openapiSpec.tags.notifications.name"), description: t("openapiSpec.tags.notifications.description") },
      { name: t("openapiSpec.tags.quickServices.name"), description: t("openapiSpec.tags.quickServices.description") },
      { name: t("openapiSpec.tags.snippets.name"), description: t("openapiSpec.tags.snippets.description") },
      { name: t("openapiSpec.tags.backups.name"), description: t("openapiSpec.tags.backups.description") },
      { name: t("openapiSpec.tags.ai.name"), description: t("openapiSpec.tags.ai.description") },
      { name: t("openapiSpec.tags.system.name"), description: t("openapiSpec.tags.system.description") },
    ],
    paths: buildCatalogPaths({
      "/login": {
        post: {
          tags: [t("openapiSpec.tags.auth.name")],
          summary: t("openapiSpec.paths./login.post.summary"),
          security: [],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["username", "password"],
                  properties: {
                    username: { type: "string" },
                    password: { type: "string" },
                  },
                },
              },
            },
          },
          responses: {
            "200": { description: t("openapiSpec.paths./login.post.responses.200") },
            "401": { description: t("openapiSpec.paths./login.post.responses.401") },
          },
        },
      },
      "/auth/signout": {
        post: {
          tags: [t("openapiSpec.tags.auth.name")],
          summary: t("openapiSpec.paths./auth/signout.post.summary"),
          responses: { "200": { description: t("openapiSpec.paths./auth/signout.post.responses.200") } },
        },
      },
      "/auth/2fa/setup": {
        post: {
          tags: [t("openapiSpec.tags.auth.name")],
          summary: t("openapiSpec.paths./auth/2fa/setup.post.summary"),
          responses: { "200": { description: t("openapiSpec.paths./auth/2fa/setup.post.responses.200") } },
        },
        put: {
          tags: [t("openapiSpec.tags.auth.name")],
          summary: t("openapiSpec.paths./auth/2fa/setup.put.summary"),
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["code", "secret"],
                  properties: {
                    code: { type: "string" },
                    secret: { type: "string" },
                  },
                },
              },
            },
          },
          responses: { "200": { description: t("openapiSpec.paths./auth/2fa/setup.put.responses.200") } },
        },
      },
      "/auth/2fa/enable": {
        post: {
          tags: [t("openapiSpec.tags.auth.name")],
          summary: t("openapiSpec.paths./auth/2fa/enable.post.summary"),
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["code", "secret"],
                  properties: {
                    code: { type: "string" },
                    secret: { type: "string" },
                  },
                },
              },
            },
          },
          responses: { "200": { description: t("openapiSpec.paths./auth/2fa/enable.post.responses.200") } },
        },
      },
      "/auth/2fa/disable": {
        post: {
          tags: [t("openapiSpec.tags.auth.name")],
          summary: t("openapiSpec.paths./auth/2fa/disable.post.summary"),
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["code"],
                  properties: { code: { type: "string" } },
                },
              },
            },
          },
          responses: { "200": { description: t("openapiSpec.paths./auth/2fa/disable.post.responses.200") } },
        },
      },
      "/servers/monitor": {
        get: {
          tags: [t("openapiSpec.tags.servers.name")],
          summary: t("openapiSpec.paths./servers/monitor.get.summary"),
          security: [{ cookieAuth: [] }, { apiTokenAuth: [] }],
          parameters: [
            {
              name: "id",
              in: "query",
              schema: { type: "string" },
              description: t("openapiSpec.paths./servers/monitor.get.parameters.id"),
            },
          ],
          responses: { "200": { description: t("openapiSpec.paths./servers/monitor.get.responses.200") } },
        },
      },
      "/storage/local": {
        get: {
          tags: [t("openapiSpec.tags.files.name")],
          summary: t("openapiSpec.paths./storage/local.get.summary"),
          security: [{ cookieAuth: [] }, { apiTokenAuth: [] }],
          parameters: [
            {
              name: "path",
              in: "query",
              schema: { type: "string" },
              description: t("openapiSpec.paths./storage/local.get.parameters.path"),
            },
          ],
          responses: { "200": { description: t("openapiSpec.paths./storage/local.get.responses.200") } },
        },
      },
      "/storage/sftp": {
        get: {
          tags: [t("openapiSpec.tags.files.name")],
          summary: t("openapiSpec.paths./storage/sftp.get.summary"),
          security: [{ cookieAuth: [] }, { apiTokenAuth: [] }],
          responses: { "200": { description: t("openapiSpec.paths./storage/sftp.get.responses.200") } },
        },
        post: {
          tags: [t("openapiSpec.tags.files.name")],
          summary: t("openapiSpec.paths./storage/sftp.post.summary"),
          responses: { "200": { description: t("openapiSpec.paths./storage/sftp.post.responses.200") } },
        },
      },
      "/downloads": {
        get: {
          tags: [t("openapiSpec.tags.downloads.name")],
          summary: t("openapiSpec.paths./downloads.get.summary"),
          responses: { "200": { description: t("openapiSpec.paths./downloads.get.responses.200") } },
        },
        post: {
          tags: [t("openapiSpec.tags.downloads.name")],
          summary: t("openapiSpec.paths./downloads.post.summary"),
          responses: { "200": { description: t("openapiSpec.paths./downloads.post.responses.200") } },
        },
      },
      "/images/upload": {
        post: {
          tags: [t("openapiSpec.tags.imageBed.name")],
          summary: t("openapiSpec.paths./images/upload.post.summary"),
          security: [{ cookieAuth: [] }, { apiTokenAuth: [] }],
          requestBody: {
            required: true,
            content: {
              "multipart/form-data": {
                schema: {
                  type: "object",
                  required: ["file"],
                  properties: { file: { type: "string", format: "binary" } },
                },
              },
            },
          },
          responses: { "201": { description: t("openapiSpec.paths./images/upload.post.responses.200") } },
        },
      },
      "/images/list": {
        get: {
          tags: [t("openapiSpec.tags.imageBed.name")],
          summary: t("openapiSpec.paths./images/list.get.summary"),
          security: [{ cookieAuth: [] }, { apiTokenAuth: [] }],
          responses: { "200": { description: t("openapiSpec.paths./images/list.get.responses.200") } },
        },
      },
      "/docker/containers": {
        get: {
          tags: [t("openapiSpec.tags.docker.name")],
          summary: t("openapiSpec.paths./docker/containers.get.summary"),
          parameters: [
            {
              name: "id",
              in: "query",
              schema: { type: "string" },
              description: t("openapiSpec.paths./docker/containers.get.parameters.id"),
            },
            {
              name: "logs",
              in: "query",
              schema: { type: "string" },
              description: t("openapiSpec.paths./docker/containers.get.parameters.logs"),
            },
          ],
          responses: { "200": { description: t("openapiSpec.paths./docker/containers.get.responses.200") } },
        },
        post: {
          tags: [t("openapiSpec.tags.docker.name")],
          summary: t("openapiSpec.paths./docker/containers.post.summary"),
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["id", "action"],
                  properties: {
                    id: { type: "string" },
                    action: {
                      type: "string",
                      enum: ["start", "stop", "restart", "remove"],
                    },
                  },
                },
              },
            },
          },
          responses: { "200": { description: t("openapiSpec.paths./docker/containers.post.responses.200") } },
        },
      },
      "/monitoring/stats": {
        get: {
          tags: [t("openapiSpec.tags.monitoring.name")],
          summary: t("openapiSpec.paths./monitoring/stats.get.summary"),
          responses: { "200": { description: t("openapiSpec.paths./monitoring/stats.get.responses.200") } },
        },
      },
      "/users": {
        get: {
          tags: [t("openapiSpec.tags.users.name")],
          summary: t("openapiSpec.paths./users.get.summary"),
          responses: { "200": { description: t("openapiSpec.paths./users.get.responses.200") } },
        },
        post: {
          tags: [t("openapiSpec.tags.users.name")],
          summary: t("openapiSpec.paths./users.post.summary"),
          responses: { "200": { description: t("openapiSpec.paths./users.post.responses.200") } },
        },
      },
      "/users/permissions": {
        get: {
          tags: [t("openapiSpec.tags.users.name")],
          summary: t("openapiSpec.paths./users/permissions.get.summary"),
          responses: { "200": { description: t("openapiSpec.paths./users/permissions.get.responses.200") } },
        },
      },
      "/audit": {
        get: {
          tags: [t("openapiSpec.tags.audit.name")],
          summary: t("openapiSpec.paths./audit.get.summary"),
          parameters: [
            { name: "page", in: "query", schema: { type: "integer" } },
            { name: "pageSize", in: "query", schema: { type: "integer" } },
          ],
          responses: { "200": { description: t("openapiSpec.paths./audit.get.responses.200") } },
        },
      },
      "/notifications": {
        get: {
          tags: [t("openapiSpec.tags.notifications.name")],
          summary: t("openapiSpec.paths./notifications.get.summary"),
          responses: { "200": { description: t("openapiSpec.paths./notifications.get.responses.200") } },
        },
      },
      "/quick-services": {
        get: {
          tags: [t("openapiSpec.tags.quickServices.name")],
          summary: t("openapiSpec.paths./quick-services.get.summary"),
          responses: { "200": { description: t("openapiSpec.paths./quick-services.get.responses.200") } },
        },
      },
      "/snippets": {
        get: {
          tags: [t("openapiSpec.tags.snippets.name")],
          summary: t("openapiSpec.paths./snippets.get.summary"),
          responses: { "200": { description: t("openapiSpec.paths./snippets.get.responses.200") } },
        },
        post: {
          tags: [t("openapiSpec.tags.snippets.name")],
          summary: t("openapiSpec.paths./snippets.post.summary"),
          responses: { "200": { description: t("openapiSpec.paths./snippets.post.responses.200") } },
        },
      },
      "/backups": {
        get: {
          tags: [t("openapiSpec.tags.backups.name")],
          summary: t("openapiSpec.paths./backups.get.summary"),
          responses: { "200": { description: t("openapiSpec.paths./backups.get.responses.200") } },
        },
        post: {
          tags: [t("openapiSpec.tags.backups.name")],
          summary: t("openapiSpec.paths./backups.post.summary"),
          responses: { "201": { description: t("openapiSpec.paths./backups.post.responses.201") } },
        },
      },
      "/dashboard/analytics": {
        get: {
          tags: [t("openapiSpec.tags.system.name")],
          summary: t("openapiSpec.paths./dashboard/analytics.get.summary"),
          parameters: [
            {
              name: "type",
              in: "query",
              schema: {
                type: "string",
                enum: ["servers", "downloads", "audit", "image-bed"],
              },
            },
          ],
          responses: { "200": { description: t("openapiSpec.paths./dashboard/analytics.get.responses.200") } },
        },
      },
      "/system-health": {
        get: {
          tags: [t("openapiSpec.tags.system.name")],
          summary: t("openapiSpec.paths./system-health.get.summary"),
          responses: { "200": { description: t("openapiSpec.paths./system-health.get.responses.200") } },
        },
      },
      "/health": {
        get: {
          tags: [t("openapiSpec.tags.system.name")],
          summary: t("openapiSpec.paths./health.get.summary"),
          security: [{ cookieAuth: [] }, { apiTokenAuth: [] }],
          responses: { "200": { description: "OK" } },
        },
      },
      "/settings": {
        get: {
          tags: [t("openapiSpec.tags.system.name")],
          summary: t("openapiSpec.paths./settings.get.summary"),
          responses: { "200": { description: t("openapiSpec.paths./settings.get.responses.200") } },
        },
        put: {
          tags: [t("openapiSpec.tags.system.name")],
          summary: t("openapiSpec.paths./settings.put.summary"),
          responses: { "200": { description: t("openapiSpec.paths./settings.put.responses.200") } },
        },
      },
      "/status": {
        get: {
          tags: [t("openapiSpec.tags.system.name")],
          summary: t("openapiSpec.paths./status.get.summary"),
          security: [],
          responses: { "200": { description: t("openapiSpec.paths./status.get.responses.200") } },
        },
      },
    }, t),
    components: {
      securitySchemes: {
        cookieAuth: { type: "apiKey", in: "cookie", name: "session" },
        basicAuth: { type: "http", scheme: "basic" },
        webhookSignature: {
          type: "apiKey",
          in: "header",
          name: "X-VControlHub-Signature",
        },
        apiTokenAuth: {
          type: "http",
          scheme: "bearer",
          bearerFormat: "VControlHub API Token",
          description:
            "Create a scoped token under /api-tokens. Bearer access is supported only by operations that explicitly list apiTokenAuth.",
        },
      },
    },
    security: [{ cookieAuth: [] }],
  };
}

export async function GET(request: Request) {
  return withApiRoute(request, { requireAuth: true }, async () => {
    const locale = await getServerLocale();
    const tr = (key: string, vars?: Record<string, string | number>) => t(key, locale, vars);
    return NextResponse.json(buildOpenApiSpec(tr));
  });
}
