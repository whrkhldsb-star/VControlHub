import { NextResponse } from "next/server";

import { teamWhere } from "@/lib/auth/team-scope";
import { prisma } from "@/lib/db";
import { deriveDownloadFileNameFromUrl } from "@/lib/downloads/helpers";
import { canAccessDownloadTask } from "@/lib/downloads/route-helpers";
import { getDownloadTargetRelativePath } from "@/lib/downloads/target-path";
import { withApiRoute } from "@/lib/http/api-guard";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return withApiRoute(
    request,
    { permission: "storage:read", errorMessage: "Failed to fetch recent downloads" },
    async ({ session }) => {
      if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

      const tasks = await prisma.downloadTask.findMany({
        where: {
          status: "COMPLETED",
          ...teamWhere(session),
          server: { storageNode: { isNot: null } },
        },
        select: {
          id: true,
          url: true,
          fileName: true,
          targetPath: true,
          createdBy: true,
          updatedAt: true,
          server: {
            select: {
              storageNode: {
                select: { id: true, name: true, driver: true, basePath: true },
              },
            },
          },
        },
        orderBy: { updatedAt: "desc" },
        take: 8,
      });

      const visibleTasks = [];
      for (const task of tasks) {
        if (await canAccessDownloadTask({ session, task, operation: "read" })) {
          visibleTasks.push(task);
        }
      }

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
