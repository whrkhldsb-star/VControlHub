import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { withApiRoute, requestLocale } from "@/lib/http/api-guard";
import { GENERAL_WRITE_LIMIT } from "@/lib/http/rate-limit-presets";
import { sessionHasPermission } from "@/lib/auth/authorization";
import { teamWhere } from "@/lib/auth/team-scope";
import { ForbiddenError, ValidationError } from "@/lib/errors";
import { normalizeStorageTargetDirectory } from "@/lib/storage/path-utils";
import {
  FILE_OPERATION_JOB_TYPE,
  fileOperationSchema,
} from "@/lib/files/operation-schema";
import { hashToInt32 } from "@/lib/concurrency/advisory-lock";
import { apiCopy } from "@/lib/i18n/api-copy";
import { assertStorageAccess } from "@/lib/storage/access-control";

export const dynamic = "force-dynamic";
const errorMessage = () =>
  apiCopy("apiCopy.failed.to.save.preferences.7cb9dce5");

export async function POST(request: Request) {
  return withApiRoute(
    request,
    {
      // Session-only guard here: the action-specific storage:write/delete
      // check below is the single permission gate for this route.
      requireAuth: true,
      rateLimit: GENERAL_WRITE_LIMIT,
      bodySchema: fileOperationSchema,
      errorMessage: errorMessage(),
    },
    async ({ session, body }) => {
      const allowed =
        body.action === "delete"
          ? sessionHasPermission(session, "storage:delete")
          : sessionHasPermission(session, "storage:write");
      if (!allowed)
        throw new ForbiddenError(apiCopy("apiCopy.files.op.denied"));
      const target = normalizeStorageTargetDirectory(body.targetDir);
      if (body.action !== "delete" && !target.ok)
        throw new ValidationError(target.reason);
      const matchesRequest = (job: {
        createdBy: string | null;
        teamId: string | null;
        type: string;
        payload: unknown;
      }) => {
        const saved = job.payload as Record<string, unknown>;
        const requestedIds = saved.requestedFileEntryIds ?? saved.fileEntryIds;
        return (
          job.createdBy === session.userId &&
          job.teamId === (session.currentTeamId ?? null) &&
          job.type === FILE_OPERATION_JOB_TYPE &&
          saved.action === body.action &&
          saved.targetDir === body.targetDir &&
          saved.policy === body.policy &&
          Array.isArray(requestedIds) &&
          JSON.stringify([...requestedIds].sort()) ===
            JSON.stringify([...body.fileEntryIds].sort())
        );
      };
      const previous = await prisma.job.findUnique({
        where: { id: body.requestId },
      });
      if (previous) {
        if (!matchesRequest(previous))
          throw new ValidationError(apiCopy("apiCopy.files.op.requestUsed"));
        return NextResponse.json({ id: previous.id }, { status: 202 });
      }
      const entries = await prisma.fileEntry.findMany({
        where: {
          id: { in: body.fileEntryIds },
          isDeleted: false,
          storageNode: teamWhere(session),
        },
        select: {
          id: true,
          storageNodeId: true,
          relativePath: true,
          entryType: true,
        },
      });
      if (entries.length !== body.fileEntryIds.length)
        throw new ValidationError(apiCopy("apiCopy.files.op.unavailable"));
      for (let offset = 0; offset < entries.length; offset += 20) {
        const access = await Promise.all(
          entries.slice(offset, offset + 20).map((entry) =>
            assertStorageAccess({
              session: session,
              storageNodeId: entry.storageNodeId,
              relativePath: entry.relativePath,
              operation:
                body.action === "copy"
                  ? "read"
                  : body.action === "delete"
                    ? "delete"
                    : "write",
            }),
          ),
        );
        if (access.some((item) => !item.allowed))
          throw new ForbiddenError(apiCopy("apiCopy.files.op.unavailable"));
      }
      const ids = entries
        .filter(
          (entry) =>
            !entries.some(
              (parent) =>
                parent.id !== entry.id &&
                parent.storageNodeId === entry.storageNodeId &&
                parent.entryType === "DIRECTORY" &&
                entry.relativePath.startsWith(`${parent.relativePath}/`),
            ),
        )
        .map((entry) => entry.id);
      const payload = {
        ...body,
        locale: requestLocale(request),
        fileEntryIds: ids,
        requestedFileEntryIds: body.fileEntryIds,
        names: Object.fromEntries(
          entries.map((entry) => [entry.id, entry.relativePath]),
        ),
      };
      const job = await prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(45087, ${hashToInt32(body.requestId)})`;
        const existing = await tx.job.findUnique({
          where: { id: body.requestId },
        });
        if (existing) {
          if (!matchesRequest(existing))
            throw new ValidationError(apiCopy("apiCopy.files.op.requestUsed"));
          return existing;
        }
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(45088, ${hashToInt32(session.userId)})`;
        const pending = await tx.job.count({
          where: {
            type: FILE_OPERATION_JOB_TYPE,
            createdBy: session.userId,
            status: { in: ["PENDING", "RUNNING"] },
          },
        });
        if (pending >= 20)
          throw new ValidationError(apiCopy("apiCopy.files.op.queueFull"));
        return tx.job.create({
          data: {
            id: body.requestId,
            type: FILE_OPERATION_JOB_TYPE,
            title: `${body.action} ${ids.length}`,
            payload,
            createdBy: session.userId,
            teamId: session.currentTeamId,
            maxAttempts: 1,
            targetStorageNodeId: entries[0]?.storageNodeId,
          },
        });
      });
      return NextResponse.json({ id: job.id }, { status: 202 });
    },
  );
}

export async function GET(request: Request) {
  return withApiRoute(
    request,
    { permission: "storage:read", errorMessage: errorMessage() },
    async ({ session }) => {
      const scope = {
        type: FILE_OPERATION_JOB_TYPE,
        createdBy: session.userId,
        ...teamWhere(session),
      };
      const select = {
        id: true,
        title: true,
        status: true,
        progress: true,
        result: true,
        errorMessage: true,
        createdAt: true,
        payload: true,
      } as const;
      const [active, recent] = await Promise.all([
        prisma.job.findMany({
          where: { ...scope, status: { in: ["PENDING", "RUNNING"] } },
          orderBy: { createdAt: "asc" },
          take: 20,
          select,
        }),
        prisma.job.findMany({
          where: { ...scope, status: { notIn: ["PENDING", "RUNNING"] } },
          orderBy: { createdAt: "desc" },
          take: 30,
          select,
        }),
      ]);
      const jobs = [
        ...new Map([...active, ...recent].map((job) => [job.id, job])).values(),
      ];
      return NextResponse.json(
        {
          jobs: jobs.map(({ payload, ...job }) => {
            const parsed = fileOperationSchema.safeParse(payload);
            const results =
              (
                job.result as {
                  items?: Array<{ id: string; state: string }>;
                } | null
              )?.items ?? [];
            const retryIds = parsed.success
              ? parsed.data.fileEntryIds.filter(
                  (id) =>
                    !results.some(
                      (item) => item.id === id && item.state !== "error",
                    ),
                )
              : [];
            return {
              ...job,
              // Structured action + count so clients never have to parse the
              // display title (`"${action} ${count}"`) to derive i18n keys.
              action: parsed.success ? parsed.data.action : null,
              count: parsed.success ? parsed.data.fileEntryIds.length : null,
              cancelRequested: Boolean(
                (payload as Record<string, unknown>).cancelRequested,
              ),
              retry:
                parsed.success &&
                ["FAILED", "CANCELLED"].includes(job.status) &&
                retryIds.length
                  ? { ...parsed.data, fileEntryIds: retryIds }
                  : null,
            };
          }),
        },
        { headers: { "Cache-Control": "private, no-store" } },
      );
    },
  );
}

export async function PATCH(request: Request) {
  return withApiRoute(
    request,
    {
      permission: "storage:read",
      bodySchema: z.object({ id: z.string().uuid() }),
      errorMessage: errorMessage(),
    },
    async ({ session, body }) => {
      const job = await prisma.job.findFirst({
        where: {
          id: body.id,
          createdBy: session.userId,
          type: FILE_OPERATION_JOB_TYPE,
          ...teamWhere(session),
          status: { in: ["PENDING", "RUNNING"] },
        },
      });
      if (!job)
        throw new ValidationError(apiCopy("apiCopy.files.op.taskUnavailable"));
      await prisma.job.updateMany({
        where: { id: job.id, status: { in: ["PENDING", "RUNNING"] } },
        data: {
          payload: {
            ...(job.payload as Record<string, string>),
            cancelRequested: true,
          },
        },
      });
      return NextResponse.json({ requested: true });
    },
  );
}
