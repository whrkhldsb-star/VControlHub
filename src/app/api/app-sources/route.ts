import { NextResponse } from "next/server";
import { z } from "zod";

import { prisma } from "@/lib/db";
import { withApiRoute } from "@/lib/http/api-guard";
import { GENERAL_WRITE_LIMIT } from "@/lib/http/rate-limit-presets";
import { parseSearchParams } from "@/lib/http/parse-search-params";
import { type NormalizedApp } from "@/lib/quick-service/adapters";
import { SERVICE_CATALOG } from "@/lib/quick-service/catalog";
import {
  getRemoteApps,
  syncAllSources,
  syncSource,
} from "@/lib/quick-service/app-source-sync";
import { listQuickServices } from "@/lib/quick-service/service";
import { normalizePublicHttpUrl } from "@/lib/storage/direct-access-url";

import { AppError, ConflictError } from "@/lib/errors";
import { auditUserAction } from "@/lib/audit/service";
export const dynamic = "force-dynamic";

/* ── GET /api/app-sources — list sources + remote apps ────────── */

export async function GET(request: Request) {
  return withApiRoute(
    request,
    { permission: "user:manage", errorMessage: "Server error" },
    async () => {
      const { includeApps = true } = parseSearchParams(
        request,
        z.object({
          includeApps: z
            .string()
            .optional()
            .transform((value) => value !== "false"),
        }),
      );

      const sources = await prisma.appSource.findMany({
        orderBy: [{ name: "asc" }],
        take: 50,
      });

      let remoteApps: NormalizedApp[] = [];
      if (includeApps) {
        remoteApps = await getRemoteApps();
      }

      const installed = await listQuickServices();
      const installedMap = new Map(
        installed.map((service) => [service.slug, service]),
      );

      const localCatalog = SERVICE_CATALOG.map((template) => ({
        slug: template.slug,
        name: template.name,
        category: template.category,
        icon: template.icon,
        description: template.description,
        image: template.image,
        defaultPort: template.defaultPort,
        internalPort: template.internalPort ?? null,
        path: template.path,
        status: installedMap.has(template.slug)
          ? installedMap.get(template.slug)!.status
          : "available",
        id: installedMap.get(template.slug)?.id ?? null,
        containerId: installedMap.get(template.slug)?.containerId ?? null,
        port: installedMap.get(template.slug)?.port ?? null,
        error: installedMap.get(template.slug)?.error ?? null,
        source: "local" as const,
      }));

      const remoteCatalog = remoteApps.map((app) => ({
        slug: app.slug,
        name: app.name,
        category: app.category,
        icon: app.icon,
        description: app.description,
        image: app.image,
        defaultPort: app.defaultPort,
        internalPort: app.internalPort ?? null,
        path: app.path,
        status: installedMap.has(app.slug)
          ? installedMap.get(app.slug)!.status
          : "available",
        id: installedMap.get(app.slug)?.id ?? null,
        containerId: installedMap.get(app.slug)?.containerId ?? null,
        port: installedMap.get(app.slug)?.port ?? null,
        error: installedMap.get(app.slug)?.error ?? null,
        source: app.sourceName as string,
        stars: app.stars,
        monthlyPulls: app.monthlyPulls,
      }));

      return NextResponse.json({
        sources,
        localCatalog,
        remoteCatalog,
      });
    },
  );
}

/* ── POST /api/app-sources — add a new source ─────────────────── */

const addSourceSchema = z.object({
  name: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[a-z0-9-]+$/),
  displayName: z.string().min(1).max(128),
  url: z.string().url(),
  type: z.enum(["json", "github", "linuxserver"]).default("json"),
});

export async function POST(request: Request) {
  return withApiRoute(
    request,
    {
      permission: "user:manage",
      rateLimit: GENERAL_WRITE_LIMIT,
      bodySchema: addSourceSchema,
      onError: (error) => {
        const msg = error instanceof Error ? error.message : "Failed to add source";
        if (msg.includes("Unique")) {
          throw new ConflictError("Source name already exists");
        }
        throw new AppError({ code: "INTERNAL_ERROR", message: msg, status: 500 });
      },
    },
    async ({ body, session }) => {
      const source = await prisma.appSource.create({
        data: {
          name: body.name,
          displayName: body.displayName,
          url: normalizePublicHttpUrl(body.url),
          type: body.type,
        },
      });

      await auditUserAction(session?.userId ?? "", "app-source.create", { sourceId: source.id }, undefined, session?.currentTeamId);
      return NextResponse.json({ source }, { status: 201 });
    },
  );
}

/* ── PATCH /api/app-sources — sync sources ─────────────────────── */

const syncSchema = z.object({
  action: z.literal("sync"),
  sourceId: z.string().optional(),
});

const toggleSchema = z.object({
  action: z.literal("toggle"),
  sourceId: z.string(),
  enabled: z.boolean(),
});

const updateSchema = z.discriminatedUnion("action", [syncSchema, toggleSchema]);

export async function PATCH(request: Request) {
  return withApiRoute(
    request,
    {
      permission: "user:manage",
      rateLimit: GENERAL_WRITE_LIMIT,
      errorMessage: "Operation failed",
      bodySchema: updateSchema,
    },
    async ({ session, body }) => {
      if (body.action === "sync") {
        if (body.sourceId) {
          const result = await syncSource(body.sourceId);
          await auditUserAction(session?.userId ?? "", "app-source.sync", {
            sourceId: body.sourceId,
            mode: "single",
          }, undefined, session?.currentTeamId);
          return NextResponse.json({ result });
        }
        const results = await syncAllSources();
        await auditUserAction(session?.userId ?? "", "app-source.sync", {
          mode: "all",
          resultCount: Array.isArray(results) ? results.length : null,
        }, undefined, session?.currentTeamId);
        return NextResponse.json({ results });
      }

      await prisma.appSource.update({
        where: { id: body.sourceId },
        data: { enabled: body.enabled },
      });
      await auditUserAction(session?.userId ?? "", "app-source.toggle", {
        sourceId: body.sourceId,
        enabled: body.enabled,
      }, undefined, session?.currentTeamId);
      return NextResponse.json({ ok: true });
    },
  );
}

/* ── DELETE /api/app-sources?sourceId=xxx — remove a source ──── */

export async function DELETE(request: Request) {
  return withApiRoute(
    request,
    {
      permission: "user:manage",
      rateLimit: GENERAL_WRITE_LIMIT,
      errorMessage: "Failed to delete",
    },
    async ({ session }) => {
      // Client historically uses ?sourceId=; idQuerySchema only accepts ?id=.
      // Accept either so Quick Services delete works and stays backward compatible.
      const parsed = parseSearchParams(
        request,
        z.object({
          id: z.string().trim().min(1).optional(),
          sourceId: z.string().trim().min(1).optional(),
        }).refine((v) => Boolean(v.id || v.sourceId), {
          message: "Missing id",
          path: ["id"],
        }),
      );
      const sourceId = (parsed.id ?? parsed.sourceId)!.trim();
      await prisma.appSource.delete({ where: { id: sourceId } });
      await auditUserAction(session?.userId ?? "", "app-source.delete", { sourceId }, undefined, session?.currentTeamId);
      return NextResponse.json({ ok: true });
    },
  );
}
