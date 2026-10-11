import { apiCopy } from "@/lib/i18n/api-copy";
import { NextResponse } from "next/server";

import { z } from "zod";

import { sessionHasPermission } from "@/lib/auth/authorization";
import { prisma } from "@/lib/db";
import { withApiRoute } from "@/lib/http/api-guard";
import { parseSearchParams } from "@/lib/http/parse-search-params";
import { listStorageNodes } from "@/lib/storage/service";

export const dynamic = "force-dynamic";

const SUPPORTED_DRIVER_FILTERS = new Set(["LOCAL", "SFTP"]);
const driverFilterSchema = z
  .object({
    driver: z
      .string()
      .trim()
      .transform((value) => value.toUpperCase())
      .refine((value) => value === "" || SUPPORTED_DRIVER_FILTERS.has(value), "Unsupported'sstorage nodetype")
      .optional(),
  })
  .transform((value) => value.driver ?? "");

export async function GET(request: Request) {
  return withApiRoute(
    request,
    { permission: "storage:read", errorMessage: apiCopy("apiCopy.failed.to.read.storage.node.c8b339ff") },
    async ({ session }) => {
      const driverFilter = parseSearchParams(request, driverFilterSchema);

      const storageNodes = await listStorageNodes(session);
      const canManageNodes = Boolean(session && sessionHasPermission(session, "storage:manage-node"));
      // Path grants narrow a customer account: a node with grants is listed
      // only when one of them allows reading; a node without grants is not narrowed.
      const narrowing = canManageNodes || !session
        ? null
        : await prisma.userStorageAccess.findMany({
            where: { userId: session.userId },
            select: { storageNodeId: true, canRead: true },
            take: 5000,
          });
      const readableNodeIds = narrowing && new Set(narrowing.filter((grant) => grant.canRead).map((grant) => grant.storageNodeId));
      const narrowedNodeIds = narrowing && new Set(narrowing.map((grant) => grant.storageNodeId));
      const nodes = storageNodes
        .filter((node) => !driverFilter || node.driver === driverFilter)
        .filter((node) =>
          node.driver !== "SFTP" || Boolean(node.serverId || node.server || node.host),
        )
        .filter((node) => !narrowedNodeIds || !narrowedNodeIds.has(node.id) || readableNodeIds!.has(node.id))
        .map((node) => ({
          id: node.id,
          name: node.name,
          driver: node.driver,
          basePath: node.basePath,
          ...(node.driver === "SFTP"
            ? {
                serverId: node.serverId ?? null,
                serverName: node.server?.name ?? null,
              }
            : {}),
        }));

      return NextResponse.json({ nodes });
    },
  );
}
