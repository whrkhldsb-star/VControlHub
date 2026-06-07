import { NextResponse } from "next/server";
import { z } from "zod";

import { prisma } from "@/lib/db";
import { withApiRoute } from "@/lib/http/api-guard";
import { GENERAL_WRITE_LIMIT } from "@/lib/http/rate-limit-presets";
import { type NormalizedApp } from "@/lib/quick-service/adapters";
import { SERVICE_CATALOG } from "@/lib/quick-service/catalog";
import {
  getRemoteApps,
  syncAllSources,
  syncSource,
} from "@/lib/quick-service/app-source-sync";
import { listQuickServices } from "@/lib/quick-service/service";
import { normalizePublicHttpUrl } from "@/lib/storage/direct-access-url";

export const dynamic = "force-dynamic";

/* ── GET /api/app-sources — list sources + remote apps ────────── */

export async function GET(request: Request) {
  return withApiRoute(
    request,
    { permission: "user:manage", errorMessage: "服务器错误" },
    async () => {
      const { searchParams } = new URL(request.url);
      const includeApps = searchParams.get("includeApps") !== "false";

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
      onError: (error) => {
        const msg = error instanceof Error ? error.message : "添加源失败";
        if (msg.includes("Unique")) {
          return NextResponse.json({ error: "源名称已存在" }, { status: 409 });
        }
        return NextResponse.json({ error: msg }, { status: 500 });
      },
    },
    async () => {
      const parsed = addSourceSchema.safeParse(
        await request.json().catch(() => null),
      );
      if (!parsed.success) {
        return NextResponse.json(
          { error: "输入参数无效", details: parsed.error.flatten() },
          { status: 400 },
        );
      }

      const source = await prisma.appSource.create({
        data: {
          name: parsed.data.name,
          displayName: parsed.data.displayName,
          url: normalizePublicHttpUrl(parsed.data.url),
          type: parsed.data.type,
        },
      });

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
      errorMessage: "操作失败",
    },
    async () => {
      const parsed = updateSchema.safeParse(
        await request.json().catch(() => null),
      );
      if (!parsed.success) {
        return NextResponse.json(
          { error: "输入参数无效", details: parsed.error.flatten() },
          { status: 400 },
        );
      }

      const data = parsed.data;

      if (data.action === "sync") {
        if (data.sourceId) {
          const result = await syncSource(data.sourceId);
          return NextResponse.json({ result });
        }
        const results = await syncAllSources();
        return NextResponse.json({ results });
      }

      await prisma.appSource.update({
        where: { id: data.sourceId },
        data: { enabled: data.enabled },
      });
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
      errorMessage: "删除失败",
    },
    async () => {
      const { searchParams } = new URL(request.url);
      const sourceId = searchParams.get("sourceId");
      if (!sourceId)
        return NextResponse.json({ error: "缺少 sourceId" }, { status: 400 });

      await prisma.appSource.delete({ where: { id: sourceId } });
      return NextResponse.json({ ok: true });
    },
  );
}
