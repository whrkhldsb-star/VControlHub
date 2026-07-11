import { NextResponse } from "next/server";

import { sessionHasPermission } from "@/lib/auth/authorization";
import { withApiRoute } from "@/lib/http/api-guard";
import { GENERAL_WRITE_LIMIT } from "@/lib/http/rate-limit-presets";
import {
  createAnnouncement,
  deleteAnnouncement,
  listActiveAnnouncements,
  listAnnouncements,
  updateAnnouncement,
} from "@/lib/announcement/service";
import {
  createAnnouncementSchema,
  deleteAnnouncementQuerySchema,
  updateAnnouncementSchema,
} from "@/lib/announcement/schema";
import { auditUserAction } from "@/lib/audit/service";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return withApiRoute(request, { requireAuth: true }, async ({ session }) => {
    const manage = session ? sessionHasPermission(session, "announcement:manage") : false;
    return NextResponse.json({ announcements: manage ? await listAnnouncements() : await listActiveAnnouncements() });
  });
}

export async function POST(request: Request) {
  return withApiRoute(
    request,
    {
      permission: "announcement:manage",
      rateLimit: GENERAL_WRITE_LIMIT,
      bodySchema: createAnnouncementSchema,
    },
    async ({ session, body }) => {
      const created = await createAnnouncement({
        title: body.title,
        body: body.content,
        level: body.type,
        pinned: body.pinned,
        published: body.published,
        createdBy: session?.userId,
        startsAt: body.startsAt ? new Date(body.startsAt) : undefined,
        expiresAt: body.expiresAt ? new Date(body.expiresAt) : null,
      });
      await auditUserAction(session?.userId ?? "", "announcement.create", { announcementId: created.id });
      return NextResponse.json({ announcement: created }, { status: 201 });
    },
  );
}

export async function PATCH(request: Request) {
  return withApiRoute(
    request,
    {
      permission: "announcement:manage",
      rateLimit: GENERAL_WRITE_LIMIT,
      bodySchema: updateAnnouncementSchema,
    },
    async ({ body }) => {
      const { id, content, type, expiresAt, ...rest } = body;
      const result = await updateAnnouncement(id, {
        ...rest,
        body: content,
        level: type,
        expiresAt: expiresAt === undefined ? undefined : expiresAt === null ? null : new Date(expiresAt),
      });
      return NextResponse.json({ announcement: result });
    },
  );
}

export async function DELETE(request: Request) {
  return withApiRoute(
    request,
    {
      permission: "announcement:manage",
      rateLimit: GENERAL_WRITE_LIMIT,
      querySchema: deleteAnnouncementQuerySchema,
    },
    async ({ query, session }) => {
      await deleteAnnouncement(query.id);
      await auditUserAction(session?.userId ?? "", "announcement.delete", { announcementId: query.id });
      return NextResponse.json({ success: true });
    },
  );
}
