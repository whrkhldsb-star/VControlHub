/**
 * User preferences API — per-user settings stored in localStorage on client,
 * with optional server-side persistence via the User model.
 * GET  /api/preferences  — get current user preferences
 * PUT  /api/preferences  — update preferences
 */
import { NextResponse } from "next/server";
import { z } from "zod";

import { prisma } from "@/lib/db";
import { withApiRoute } from "@/lib/http/api-guard";
import { GENERAL_WRITE_LIMIT } from "@/lib/http/rate-limit-presets";
import { defaultUserPreferences, normalizeUserPreferences } from "@/lib/preferences/user-preferences";
import { withCacheHeaders, CachePresets } from "@/lib/cache";

import { AuthError } from "@/lib/errors";
const prefsSchema = z.object({
  defaultPage: z.string().optional(),
  dashboardWidgets: z.array(z.string()).optional(),
  notificationsEnabled: z.boolean().optional(),
  notificationSound: z.boolean().optional(),
  autoRefreshInterval: z.number().optional(),
  autoProbeEnabled: z.boolean().optional(),
  autoProbeIntervalSec: z.number().optional(),
});

const defaultPreferences = defaultUserPreferences;

export async function GET(request: Request) {
  return withApiRoute(
    request,
    { requireAuth: true, errorMessage: "Failed to fetch preferences" },
    async ({ session }) => {
      if (!session)
        throw new AuthError("Unauthorized");

      const user = await prisma.user.findUnique({
        where: { id: session.userId },
        select: { preferences: true },
      });

      const prefs = user?.preferences
        ? normalizeUserPreferences({
            ...defaultPreferences,
            ...(typeof user.preferences === "object" ? user.preferences : {}),
          })
        : defaultPreferences;

      return withCacheHeaders(NextResponse.json(prefs), CachePresets.shortLived);
    },
  );
}

export async function PUT(request: Request) {
  return withApiRoute(
    request,
    {
      requireAuth: true,
      rateLimit: GENERAL_WRITE_LIMIT,
      bodySchema: prefsSchema,
      errorMessage: "Failed to save preferences",
    },
    async ({ session, body }) => {
      if (!session)
        throw new AuthError("Unauthorized");

      // Partial PUT: merge into existing preferences so clients that only send
      // autoProbe* / one field (e.g. servers AutoProbeProvider) do not wipe
      // defaultPage, widgets, refresh interval, etc. back to defaults.
      const existingRow = await prisma.user.findUnique({
        where: { id: session.userId },
        select: { preferences: true },
      });
      const existing =
        existingRow?.preferences && typeof existingRow.preferences === "object"
          ? (existingRow.preferences as Record<string, unknown>)
          : {};
      const prefs = normalizeUserPreferences({
        ...defaultPreferences,
        ...existing,
        ...body,
      });

      await prisma.user.update({
        where: { id: session.userId },
        data: { preferences: JSON.parse(JSON.stringify(prefs)) },
      });

      return NextResponse.json(prefs);
    },
  );
}
