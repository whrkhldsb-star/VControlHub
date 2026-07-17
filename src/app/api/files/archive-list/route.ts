import { NextRequest, NextResponse } from "next/server";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import {
  resolveStoragePathWithinBase,
  sanitizeArchiveEntries,
} from "@/lib/storage/path-utils";
import { withApiRoute } from "@/lib/http/api-guard";
import { parseSearchParams } from "@/lib/http/parse-search-params";
import { assertStorageAccess } from "@/lib/storage/access-control";
import { teamWhere } from "@/lib/auth/team-scope";
import { prisma } from "@/lib/db";
import { archiveListQuerySchema } from "@/lib/files/schema";

import { AppError, AuthError, NotFoundError, ValidationError } from "@/lib/errors";
const execFileAsync = promisify(execFile);

export const dynamic = "force-dynamic";

type ArchiveEntry = {
  name: string;
  size: number;
  isDirectory: boolean;
  modified?: string;
};

export async function GET(request: NextRequest) {
  return withApiRoute(
    request,
    { permission: "storage:read", errorMessage: "Failed to read archive" },
    async ({ session }) => {
      if (!session)
        throw new AuthError("Unauthorized");
      const { nodeId, relativePath, driver, name } = parseSearchParams(
        request,
        archiveListQuerySchema,
      );
      const _cleanedRelativePath = (relativePath ?? "").replace(/^\/+/, "");

      if (driver !== "LOCAL") {
        return NextResponse.json(
          { error: "Only local storage node archive viewing is supported" },
          { status: 400 },
        );
      }

      if (!relativePath) {
        throw new ValidationError("Missing file path");
      }

      const node = await prisma.storageNode.findFirst({
        where: { id: nodeId, ...teamWhere(session) },
        select: { id: true, name: true, driver: true, basePath: true },
      });
      if (!node) {
        throw new NotFoundError("Storage node not found");
      }

      const resolvedPath = resolveStoragePathWithinBase(
        node.basePath,
        relativePath,
      );
      if (!resolvedPath.ok) {
        return NextResponse.json(
          { error: resolvedPath.reason },
          { status: 400 },
        );
      }

      const accessDecision = await assertStorageAccess({
        session,
        storageNodeId: node.id,
        relativePath,
        operation: "read",
      });
      if (!accessDecision.allowed) {
        return NextResponse.json(
          { error: accessDecision.reason ?? "No access permission for this storage node or path" },
          { status: 403 },
        );
      }

      const fullPath = resolvedPath.path;

      try {
        const entries = sanitizeArchiveEntries(
          await listArchiveContents(name, fullPath),
        );
        return NextResponse.json({ entries });
      } catch (err) {
        const message = err instanceof Error ? err.message : "Failed to read archive";
        throw new AppError({ code: "INTERNAL_ERROR", message: message, status: 500 });
      }
    },
  );
}

async function listArchiveContents(
  name: string,
  fullPath: string,
): Promise<ArchiveEntry[]> {
  const lowerName = name.toLowerCase();
  const ext = path.extname(lowerName);

  if (ext === ".zip" || ext === ".jar") {
    return listZip(fullPath);
  }
  if (lowerName.endsWith(".tar.gz") || lowerName.endsWith(".tgz")) {
    return listTarGz(fullPath);
  }
  if (ext === ".tar") {
    return listTar(fullPath);
  }
  if (ext === ".gz") {
    return listGz(fullPath, name);
  }
  if (ext === ".7z") {
    return list7z(fullPath);
  }
  if (ext === ".rar") {
    return listRar(fullPath);
  }
  throw new Error(`Unsupported archive format: ${ext}`);
}

async function listZip(filePath: string): Promise<ArchiveEntry[]> {
  const { stdout } = await execFileAsync("unzip", ["-l", filePath], {
    maxBuffer: 10 * 1024 * 1024,
    timeout: 15000,
  });
  return parseUnzipOutput(stdout);
}

function parseUnzipOutput(output: string): ArchiveEntry[] {
  const lines = output.split("\n");
  const entries: ArchiveEntry[] = [];
  // unzip -l format:
  //   Length  Date        Time    Name
  //   ------  ----        ----    ----
  //   12345   01-01-2024  12:00   some/file.txt
  // End lines: "----" and summary
  for (const line of lines) {
    const match = line.match(
      /^\s*(\d+)\s+(\d{2}-\d{2}-\d{4})\s+(\d{2}:\d{2})\s+(.+)$/,
    );
    if (match) {
      const size = parseInt(match[1]!, 10);
      const name = match[4]!.trim();
      if (!name) continue;
      const isDirectory = name.endsWith("/");
      entries.push({
        name: isDirectory ? name.slice(0, -1) : name,
        size,
        isDirectory,
        modified: `${match[2]!} ${match[3]!}`,
      });
    }
  }
  return entries;
}

async function listTarGz(filePath: string): Promise<ArchiveEntry[]> {
  const { stdout } = await execFileAsync("tar", ["-tzvf", filePath], {
    maxBuffer: 10 * 1024 * 1024,
    timeout: 15000,
  });
  return parseTarOutput(stdout);
}

async function listTar(filePath: string): Promise<ArchiveEntry[]> {
  const { stdout } = await execFileAsync("tar", ["-tvf", filePath], {
    maxBuffer: 10 * 1024 * 1024,
    timeout: 15000,
  });
  return parseTarOutput(stdout);
}

function parseTarOutput(output: string): ArchiveEntry[] {
  const lines = output.split("\n");
  const entries: ArchiveEntry[] = [];
  for (const line of lines) {
    const match = line.match(
      /^([dlcbps-])(.{9})\s+\S+\s+(\d+)\s+((?:\w{3}\s+\d{1,2}\s+\d{1,2}:\d{2})|(?:\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}))\s+(.+)$/,
    );
    if (match) {
      const typeChar = match[1]!;
      const size = parseInt(match[3]!, 10);
      const name = match[5]!.trim();
      if (!name) continue;
      const isDirectory = typeChar === "d" || name.endsWith("/");
      entries.push({
        name: isDirectory ? name.replace(/\/$/, "") : name,
        size,
        isDirectory,
        modified: match[4]!,
      });
    }
  }
  return entries;
}

async function listGz(
  filePath: string,
  originalName: string,
): Promise<ArchiveEntry[]> {
  // .gz (non-tar) — just a single compressed file
  const innerName = originalName.replace(/\.gz$/, "");
  return [{ name: innerName, size: 0, isDirectory: false }];
}

async function list7z(filePath: string): Promise<ArchiveEntry[]> {
  try {
    const { stdout } = await execFileAsync("7z", ["l", filePath], {
      maxBuffer: 10 * 1024 * 1024,
      timeout: 15000,
    });
    return parse7zOutput(stdout);
  } catch {
    throw new Error("7z format requires the 7z command-line tool to be installed");
  }
}

function parse7zOutput(output: string): ArchiveEntry[] {
  const lines = output.split("\n");
  const entries: ArchiveEntry[] = [];
  let inListing = false;
  for (const line of lines) {
    if (line.includes("-----") && line.includes("----")) {
      inListing = !inListing;
      continue;
    }
    if (inListing) {
      // 7z l format: date time attr size compressed name
      const match = line.match(
        /^\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}\s+([.D]+)\s+(\d+)\s+\d+\s+(.+)$/,
      );
      if (match) {
        const attr = match[1]!;
        const size = parseInt(match[2]!, 10);
        const name = match[3]!.trim();
        if (!name) continue;
        const isDirectory = attr.startsWith("D");
        entries.push({ name, size, isDirectory });
      }
    }
  }
  return entries;
}

async function listRar(filePath: string): Promise<ArchiveEntry[]> {
  try {
    const { stdout } = await execFileAsync("unrar", ["l", filePath], {
      maxBuffer: 10 * 1024 * 1024,
      timeout: 15000,
    });
    return parseRarOutput(stdout);
  } catch {
    throw new Error("RAR format requires the unrar command-line tool to be installed");
  }
}

function parseRarOutput(output: string): ArchiveEntry[] {
  const lines = output.split("\n");
  const entries: ArchiveEntry[] = [];
  for (const line of lines) {
    const match = line.match(
      /^\s*(\S+)\s+(\d+)\s+(\d+)\s+([\d%]+)\s+(\d{2}-\d{2}-\d{4}\s+\d{2}:\d{2})\s+(.+)/,
    );
    if (match) {
      const attr = match[1]!;
      const size = parseInt(match[2]!, 10);
      const name = match[6]!.trim();
      if (!name) continue;
      const isDirectory = attr.includes("D") || name.endsWith("/");
      entries.push({
        name: isDirectory ? name.replace(/\/$/, "") : name,
        size,
        isDirectory,
        modified: match[5]!,
      });
    }
  }
  return entries;
}
