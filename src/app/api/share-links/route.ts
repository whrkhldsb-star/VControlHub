import { NextResponse } from "next/server";
import { z } from "zod";

import { withApiRoute } from "@/lib/http/api-guard";
import { GENERAL_WRITE_LIMIT } from "@/lib/http/rate-limit-presets";
import { idQuerySchema, parseSearchParams } from "@/lib/http/parse-search-params";
import {
  createShareLink,
  createShareLinkFromFileEntry,
  listShareLinks,
  revokeShareLink,
} from "@/lib/share-link/service";

const shareLinkPostSchema = z.object({
  fileEntryId: z.string().min(1).optional(),
  storageNodeId: z.string().min(1).optional(),
  path: z.string().min(1).optional(),
  entryType: z.enum(["FILE", "DIRECTORY"]).optional(),
  name: z.string().optional(),
  expiresInHours: z.number().positive().optional(),
  expiresIn: z.number().positive().optional(),
  maxDownloads: z.number().int().positive().optional().nullable(),
  password: z.string().min(1).max(128).optional(),
}).refine((data) => Boolean(data.fileEntryId || (data.storageNodeId && data.path)), {
  message: "Must select a file from file manager, or provide storage node and path",
});

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return withApiRoute(
    request,
    { permission: "share:read", errorMessage: "OperationFailed" },
    async ({ session }) => {
      if (!session) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
      return NextResponse.json({ shares: await listShareLinks(session.userId) });
    },
  );
}

export async function POST(request: Request) {
  return withApiRoute(
    request,
    {
      permission: "share:create",
      rateLimit: GENERAL_WRITE_LIMIT,
      errorMessage: "OperationFailed",
      bodySchema: shareLinkPostSchema,
    },
    async ({ session, body: data }) => {
      if (!session)
        return NextResponse.json(
          { error: "Not authenticated or session expired" },
          { status: 401 },
        );
      const result = data.fileEntryId
        ? await createShareLinkFromFileEntry({
            session,
            fileEntryId: data.fileEntryId,
            name: data.name,
            expiresInHours: data.expiresInHours ?? data.expiresIn,
            maxDownloads: data.maxDownloads,
            password: data.password,
          })
        : await createShareLink({
            session,
            storageNodeId: data.storageNodeId!,
            path: data.path!,
            entryType: data.entryType,
            name: data.name,
            expiresInHours: data.expiresInHours ?? data.expiresIn,
            maxDownloads: data.maxDownloads,
            password: data.password,
          });
      return NextResponse.json(
        { share: result.share, token: result.token },
        { status: 201 },
      );
    },
  );
}

export async function DELETE(request: Request) {
  return withApiRoute(
    request,
    {
      permission: "share:manage",
      rateLimit: GENERAL_WRITE_LIMIT,
      errorMessage: "OperationFailed",
    },
    async ({ session }) => {
      if (!session) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
      const { id } = parseSearchParams(request, idQuerySchema);
      return NextResponse.json({ share: await revokeShareLink(id, session.userId) });
    },
  );
}
