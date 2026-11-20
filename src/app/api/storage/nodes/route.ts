import { apiCopy } from "@/lib/i18n/api-copy";
import { NextResponse } from "next/server";

import { z } from "zod";

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
      .refine((value) => value === "" || SUPPORTED_DRIVER_FILTERS.has(value), "Unsupported storage node type")
      .optional(),
  })
  .transform((value) => value.driver ?? "");

export async function GET(request: Request) {
  const operation = new URL(request.url).searchParams.get("operation") === "write" ? "write" : "read";
  const guard = operation === "write" ? { permission: "storage:write" as const } : { permission: "storage:read" as const };
  return withApiRoute(
    request,
    { ...guard, errorMessage: apiCopy("apiCopy.failed.to.read.storage.node.c8b339ff") },
    async ({ session }) => {
      const driverFilter = parseSearchParams(request, driverFilterSchema);

      const storageNodes = await listStorageNodes(session, operation);
      const nodes = storageNodes
        .filter((node) => !driverFilter || node.driver === driverFilter)
        .filter((node) =>
          node.driver !== "SFTP" || Boolean(node.serverId || node.server || node.host),
        )
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
