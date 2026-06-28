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
  message: "必须从文件管理选择文件，或提供存储节点和路径",
});

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return withApiRoute(
    request,
    { permission: "share:read", errorMessage: "操作失败" },
    async () => {
      return NextResponse.json({ shares: await listShareLinks() });
    },
  );
}

export async function POST(request: Request) {
  return withApiRoute(
    request,
    {
      permission: "share:create",
      rateLimit: GENERAL_WRITE_LIMIT,
      errorMessage: "操作失败",
      bodySchema: shareLinkPostSchema,
    },
    async ({ session, body: data }) => {
      if (!session)
        return NextResponse.json(
          { error: "未登录或会话已过期" },
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
      errorMessage: "操作失败",
    },
    async () => {
      const { id } = parseSearchParams(request, idQuerySchema);
      return NextResponse.json({ share: await revokeShareLink(id) });
    },
  );
}
