import { NextResponse } from "next/server";
import { z } from "zod";

import { withApiRoute } from "@/lib/http/api-guard";
import { GENERAL_WRITE_LIMIT } from "@/lib/http/rate-limit-presets";
import { idQuerySchema, parseSearchParams } from "@/lib/http/parse-search-params";
import {
  createShareLink,
  createShareLinkFromFileEntry,
  listShareLinkPage,
  revokeShareLink,
  SHARE_LINK_MAX_PAGE_SIZE,
  SHARE_LINK_STATUS_FILTERS,
} from "@/lib/share-link/service";
import { QUICK_SHARE_DEFAULT_EXPIRY_HOURS } from "@/lib/share-link/policy";
import { auditUserAction } from "@/lib/audit/service";
import { getServerLocale, t } from "@/lib/i18n/translations";

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
  permissionLevel: z.enum(["preview", "download"]).optional(),
  quick: z.boolean().optional(),
})
  .refine((data) => Boolean(data.fileEntryId || (data.storageNodeId && data.path)), {
    message: t("api.share.selectFileOrPath"),
  })
  .refine(
    (data) => data.permissionLevel !== "preview" || (!data.password && data.maxDownloads == null),
    { message: t("api.share.previewPolicyConflict") },
  );

// Without parameters the response is the newest 200 shares, as before; `total`
// tells the caller whether more pages exist.
const shareLinkListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).optional(),
  pageSize: z.coerce.number().int().min(1).max(SHARE_LINK_MAX_PAGE_SIZE).default(SHARE_LINK_MAX_PAGE_SIZE),
  status: z.enum(SHARE_LINK_STATUS_FILTERS).optional(),
  q: z.string().trim().max(200).optional(),
});

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const locale = await getServerLocale();
  return withApiRoute(
    request,
    { permission: "share:read", errorMessage: t("api.share.operationFailed", locale) },
    async ({ session }) => {
      const query = parseSearchParams(request, shareLinkListQuerySchema);
      return NextResponse.json(await listShareLinkPage(session, query));
    },
  );
}

export async function POST(request: Request) {
  const locale = await getServerLocale();
  return withApiRoute(
    request,
    {
      permission: "share:create",
      rateLimit: GENERAL_WRITE_LIMIT,
      errorMessage: t("api.share.operationFailed", locale),
      bodySchema: shareLinkPostSchema,
    },
    async ({ session, body: data }) => {
      // The one-click file-manager action is deliberately a short public
      // link. Advanced sharing remains the explicit route for custom expiry.
      const expiresInHours = data.quick
        ? QUICK_SHARE_DEFAULT_EXPIRY_HOURS
        : (data.expiresInHours ?? data.expiresIn);
      const result = data.fileEntryId
        ? await createShareLinkFromFileEntry({
            session,
            fileEntryId: data.fileEntryId,
            name: data.name,
            expiresInHours,
            maxDownloads: data.maxDownloads,
            password: data.password,
            permissionLevel: data.permissionLevel,
          })
        : await createShareLink({
            session,
            storageNodeId: data.storageNodeId!,
            path: data.path!,
            entryType: data.entryType,
            name: data.name,
            expiresInHours,
            maxDownloads: data.maxDownloads,
            password: data.password,
            permissionLevel: data.permissionLevel,
          });
      await auditUserAction(session.userId, "share-link.create", { shareId: result.share.id }, undefined, session.currentTeamId);
      return NextResponse.json(
        { share: result.share, token: result.token },
        { status: 201 },
      );
    },
  );
}

export async function DELETE(request: Request) {
  const locale = await getServerLocale();
  return withApiRoute(
    request,
    {
      permission: "share:manage",
      rateLimit: GENERAL_WRITE_LIMIT,
      errorMessage: t("api.share.operationFailed", locale),
    },
    async ({ session }) => {
      const { id } = parseSearchParams(request, idQuerySchema);
      const share = await revokeShareLink(id, session.userId, session);
      await auditUserAction(session.userId, "share-link.delete", { shareId: id }, undefined, session.currentTeamId);
      return NextResponse.json({ share });
    },
  );
}
