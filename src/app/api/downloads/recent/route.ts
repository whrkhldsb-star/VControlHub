import { resolveTaskDrive, downloadDriveSelect } from "@/lib/downloads/destination";
import { apiCopy } from "@/lib/i18n/api-copy";
import { NextResponse } from "next/server";

import { serverTeamWhere, teamWhere } from "@/lib/auth/team-scope";
import { prisma } from "@/lib/db";
import { deriveDownloadFileNameFromUrl } from "@/lib/downloads/helpers";
import { canAccessDownloadTask } from "@/lib/downloads/route-helpers";
import { getDownloadTargetRelativePath } from "@/lib/downloads/target-path";
import { withApiRoute } from "@/lib/http/api-guard";

export const dynamic = "force-dynamic";

const RECENT_DOWNLOADS_SHOWN = 8;
const RECENT_DOWNLOADS_SCAN = 50;

export async function GET(request: Request) {
  return withApiRoute(
    request,
    { permission: "storage:read", errorMessage: apiCopy("apiCopy.failed.to.fetch.recent.downloads.a2df5c2c") },
    async ({ session }) => {
      const page = (cursor?: string) => prisma.downloadTask.findMany({
        where: {
          status: "COMPLETED",
          ...teamWhere(session),
          server: serverTeamWhere(session),
          OR: [{ server: { storageNode: { isNot: null } } }, { agentStorageNodeId: { not: null } }],
        },
        select: {
          id: true,
          url: true,
          fileName: true,
          targetPath: true,
          agentStorageNodeId: true, directStorageNodeId: true,
          updatedAt: true,
          server: {
            select: {
              storageNode: { select: downloadDriveSelect }, agentFileShares: { select: { node: { select: downloadDriveSelect } } },
            },
          },
        },
        orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        // Filtered by per-path access below: reading only the newest 8 showed
        // an account with narrow grants fewer (or none) of its own downloads.
        take: RECENT_DOWNLOADS_SCAN,
      }).then(rows => rows.map(resolveTaskDrive));

      const visibleTasks: Awaited<ReturnType<typeof page>> = [];
      let cursor: string | undefined;
      do {
        const tasks = await page(cursor);
        const flags = await Promise.all(tasks.map(task => canAccessDownloadTask({ session, task, operation: "read" })));
        visibleTasks.push(...tasks.filter((_, i) => flags[i]).slice(0, RECENT_DOWNLOADS_SHOWN - visibleTasks.length));
        cursor = tasks.length === RECENT_DOWNLOADS_SCAN ? tasks.at(-1)?.id : undefined;
      } while (cursor && visibleTasks.length < RECENT_DOWNLOADS_SHOWN);

      const downloads = visibleTasks.flatMap((task) => {
        const storageNode = task.server.storageNode;
        if (!storageNode) return [];
        try {
          const directoryPath = getDownloadTargetRelativePath(storageNode.basePath, task.targetPath);
          return [{
            id: task.id,
            fileName: task.fileName || deriveDownloadFileNameFromUrl(task.url) || task.url,
            path: directoryPath,
            completedAt: task.updatedAt.toISOString(),
            storageNode: {
              id: storageNode.id,
              name: storageNode.name,
              driver: storageNode.driver,
            },
          }];
        } catch {
          return [];
        }
      });

      return NextResponse.json({ downloads });
    },
  );
}
