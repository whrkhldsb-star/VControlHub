import { NextResponse } from "next/server";
import { z } from "zod";

import { auditUserAction } from "@/lib/audit/service";
import { prisma } from "@/lib/db";
import { withApiRoute } from "@/lib/http/api-guard";
import { buildZip } from "@/lib/deploy-export/zip";
import { NotFoundError, ValidationError } from "@/lib/errors";

import type { DeploymentExport } from "@prisma/client";

export const dynamic = "force-dynamic";

const idSchema = z.string().trim().min(1, "Export id is required");

type ExportFilesRecord = Record<string, string>;

function asStringRecord(value: unknown): ExportFilesRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const result: ExportFilesRecord = {};
  for (const [name, content] of Object.entries(value as Record<string, unknown>)) {
    if (typeof content === "string") {
      result[name] = content;
    } else if (content instanceof Uint8Array) {
      result[name] = Buffer.from(content).toString("utf-8");
    } else if (content && typeof content === "object") {
      // Prisma JSON columns are returned as plain objects; allow nested shapes by
      // stringifying them so the archive still contains the latest snapshot.
      try {
        result[name] = JSON.stringify(content, null, 2);
      } catch {
        // ignore non-serialisable entries
      }
    }
  }
  return result;
}

function exportNameFor(record: DeploymentExport): string {
  const slug =
    (record.manifest && typeof record.manifest === "object" && "appName" in record.manifest
      ? String((record.manifest as { appName?: unknown }).appName ?? "")
      : "") || record.name || "deployment-export";
  return `${slug}-portable.zip`;
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return withApiRoute(
    request,
    { permission: "deploy:export" },
    async ({ session }) => {
      if (!session) {
        // Guarded by `deploy:export` already; this is a type narrowing only.
        throw new NotFoundError("Deployment export package not found");
      }
      const { id } = await params;
      const parsedId = idSchema.safeParse(id);
      if (!parsedId.success) {
        throw new ValidationError(parsedId.error.issues[0]?.message ?? "Invalid export id");
      }
      const record = await prisma.deploymentExport.findUnique({ where: { id: parsedId.data } });
      if (!record) {
        throw new NotFoundError("Deployment export package not found");
      }
      const files = asStringRecord(record.files);
      const entries = Object.entries(files).map(([name, content]) => ({ name, content }));
      if (entries.length === 0) {
        throw new NotFoundError("Deployment export package has no downloadable files");
      }
      const zip = buildZip(entries, { mtime: record.createdAt });
      auditUserAction(session.userId, "deployment.export.download", {
        exportId: record.id,
        fileCount: entries.length,
        size: zip.length,
      });
      return new NextResponse(new Uint8Array(zip), {
        status: 200,
        headers: {
          "content-type": "application/zip",
          "content-length": String(zip.length),
          "content-disposition": `attachment; filename="${exportNameFor(record)}"`,
          "cache-control": "no-store",
        },
      });
    },
  );
}
