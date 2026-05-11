import { NextResponse } from "next/server";
import { sessionHasPermission } from "@/lib/auth/authorization";
import { requireSession } from "@/lib/auth/require-session";

import { prisma } from "@/lib/db";
import { assertStorageAccess } from "@/lib/storage/access-control";
import { listRemoteDirectory, type SftpListEntry } from "@/lib/ssh/client";
import { normalizeRemotePath, toClientStorageError } from "@/lib/storage/remote-path";

export const dynamic = "force-dynamic";

/* ------------------------------------------------------------------ */
/* MIME type inference from file extension                             */
/* ------------------------------------------------------------------ */

const EXTENSION_MIME_MAP: Record<string, string> = {
  ".txt": "text/plain",
  ".md": "text/markdown",
  ".html": "text/html",
  ".htm": "text/html",
  ".css": "text/css",
  ".js": "application/javascript",
  ".mjs": "application/javascript",
  ".ts": "application/typescript",
  ".tsx": "application/typescript",
  ".jsx": "application/javascript",
  ".json": "application/json",
  ".xml": "application/xml",
  ".yaml": "application/x-yaml",
  ".yml": "application/x-yaml",
  ".csv": "text/csv",
  ".pdf": "application/pdf",
  ".zip": "application/zip",
  ".tar": "application/x-tar",
  ".gz": "application/gzip",
  ".7z": "application/x-7z-compressed",
  ".rar": "application/vnd.rar",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".bmp": "image/bmp",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".mkv": "video/x-matroska",
  ".avi": "video/x-msvideo",
  ".mov": "video/quicktime",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".ogg": "audio/ogg",
  ".flac": "audio/flac",
  ".aac": "audio/aac",
  ".sh": "application/x-sh",
  ".py": "text/x-python",
  ".rb": "text/x-ruby",
  ".java": "text/x-java-source",
  ".c": "text/x-c",
  ".cpp": "text/x-c++src",
  ".h": "text/x-c",
  ".go": "text/x-go",
  ".rs": "text/x-rust",
  ".php": "text/x-php",
  ".log": "text/plain",
  ".env": "text/plain",
  ".conf": "text/plain",
  ".ini": "text/plain",
  ".toml": "text/x-toml",
  ".sql": "application/sql",
  ".db": "application/x-sqlite3",
  ".exe": "application/x-msdownload",
  ".dll": "application/x-msdownload",
  ".so": "application/x-sharedlib",
};

function guessMimeType(fileName: string): string | null {
  const lastDot = fileName.lastIndexOf(".");
  if (lastDot === -1) return null;
  const ext = fileName.slice(lastDot).toLowerCase();
  return EXTENSION_MIME_MAP[ext] ?? null;
}

/* ------------------------------------------------------------------ */
/* Path helpers                                                        */
/* ------------------------------------------------------------------ */

/**
 * Compute the relativePath for a remote entry relative to the storage node's basePath.
 *
 * Example:
 *   basePath = "/data"
 *   remotePath = "/data/docs"
 *   entryName = "test.txt"
 *   → "docs/test.txt"
 */
function computeRelativePath(basePath: string, remotePath: string, entryName: string): string | null {
	const normalizedBase = basePath.replace(/\/+$/, "");
	// remotePath is the directory being listed
	const normalizedRemote = remotePath.replace(/\/+$/, "");

	let relative: string;
	if (normalizedRemote === normalizedBase || normalizedRemote === "") {
		relative = entryName;
	} else if (normalizedRemote.startsWith(normalizedBase + "/")) {
		relative = normalizedRemote.slice(normalizedBase.length + 1) + "/" + entryName;
	} else {
		// remotePath is NOT under basePath — this is a bug/safety violation
		// Return null to signal the entry should be skipped
		return null;
	}

	// Remove leading slash if any
	return relative.replace(/^\/+/, "");
}

/* ------------------------------------------------------------------ */
/* POST handler                                                        */
/* ------------------------------------------------------------------ */

interface SyncResult {
  synced: number;
  created: number;
  updated: number;
  errors: string[];
}

export async function POST(request: Request) {
  const session = await requireSession();
  if (!sessionHasPermission(session, "storage:write")) {
    return NextResponse.json({ error: "缺少权限" }, { status: 403 });
  }

  let body: {
    nodeId?: string;
    remotePath?: string;
    recursive?: boolean;
    maxDepth?: number;
  };

  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "无效的请求体" }, { status: 400 });
  }

  const { nodeId, remotePath, recursive = false, maxDepth = 1 } = body;

	if (!nodeId || typeof nodeId !== "string") {
		return NextResponse.json({ error: "缺少 nodeId 参数" }, { status: 400 });
	}

	// Look up the storage node and its connection details
  const node = await prisma.storageNode.findUnique({
    where: { id: nodeId },
    select: {
      id: true,
      name: true,
      driver: true,
      basePath: true,
      host: true,
      port: true,
      username: true,
      serverId: true,
 server: {
  select: {
  id: true,
  host: true,
  port: true,
  username: true,
  connectionType: true,
  password: true,
  sshKey: {
  select: {
  privateKey: true,
  },
  },
  },
  },
    },
  });

  if (!node) {
    return NextResponse.json({ error: "存储节点不存在" }, { status: 404 });
  }

  if (node.driver !== "SFTP") {
    return NextResponse.json({ error: "该节点不是 SFTP 类型" }, { status: 400 });
  }

 // Resolve connection parameters
 const host = node.host ?? node.server?.host;
 const port = node.port ?? node.server?.port ?? 22;
 const username = node.username ?? node.server?.username ?? "root";
 const connectionType = node.server?.connectionType ?? "SSH_KEY";
const sshPrivateKey = (connectionType === "SSH_KEY" ? node.server?.sshKey?.privateKey : undefined) ?? undefined;
const sshPassword = (connectionType === "PASSWORD" ? node.server?.password : undefined) ?? undefined;

 if (!host || (connectionType === "SSH_KEY" && !sshPrivateKey) || (connectionType === "PASSWORD" && !sshPassword)) {
  return NextResponse.json(
  { error: "缺少远端主机地址或连接凭据，无法连接" },
  { status: 400 },
  );
 }

 // After the guard above, TypeScript still can't narrow these — assert non-null
 const sshHost = host;
 const sshPort = port ?? 22;
 const sshUsername = username;

   let normalizedRemotePath: string;
  try {
    normalizedRemotePath = normalizeRemotePath(node.basePath, remotePath);
  } catch {
    return NextResponse.json(toClientStorageError("同步路径超出存储节点根目录"), { status: 400 });
  }

  const accessDecision = await assertStorageAccess({
    session,
    storageNodeId: node.id,
    relativePath: remotePath,
    operation: "write",
  });
  if (!accessDecision.allowed) {
    return NextResponse.json({ error: accessDecision.reason ?? "缺少存储访问授权" }, { status: 403 });
  }

  const basePath = normalizeRemotePath(node.basePath);

 const result: SyncResult = {
 synced: 0,
 created: 0,
 updated: 0,
 errors: [],
 };

 /**
 * Recursively sync a remote directory into DB.
 * `currentDepth` starts at 0 and increments for each recursive step.
 */
 async function syncDirectory(dirPath: string, currentDepth: number): Promise<void> {
 if (recursive && currentDepth >= maxDepth) {
 return;
 }

 let entries: SftpListEntry[];
 try {
 entries = await listRemoteDirectory({
  host: sshHost,
  port: sshPort,
  username: sshUsername,
  privateKey: sshPrivateKey,
  password: sshPassword,
  remotePath: dirPath,
 });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "未知错误";
      result.errors.push(`扫描 ${dirPath} 失败：${msg}`);
      return;
    }

    for (const entry of entries) {
      if (entry.type === "other") continue;

		const entryType = entry.type === "directory" ? "DIRECTORY" : "FILE";
		const relativePath = computeRelativePath(basePath, dirPath, entry.name);

		// Skip entries that are outside basePath (safety guard)
		if (!relativePath) {
			result.errors.push(`跳过 basePath 外的条目：${dirPath}/${entry.name}`);
			continue;
		}

		const mimeType = entryType === "FILE" ? guessMimeType(entry.name) : null;

      result.synced += 1;

 try {
 // Check if a non-deleted entry with the same storageNodeId + relativePath exists
 const existing = await prisma.fileEntry.findFirst({
 where: {
 storageNodeId: node!.id,
 relativePath,
 isDeleted: false,
 },
 });

        if (existing) {
          // Update size and modifyTime info (we store size; modifyTime maps to updatedAt implicitly)
          await prisma.fileEntry.update({
            where: { id: existing.id },
            data: {
              size: entryType === "FILE" ? BigInt(entry.size) : null,
              mimeType: mimeType ?? existing.mimeType,
              name: entry.name,
            },
          });
          result.updated += 1;
        } else {
          // Check if a soft-deleted entry with same unique key exists
          const softDeleted = await prisma.fileEntry.findFirst({
            where: {
              storageNodeId: node!.id,
              relativePath,
              isDeleted: true,
            },
          });

          if (softDeleted) {
            // Restore and update the soft-deleted entry
            await prisma.fileEntry.update({
              where: { id: softDeleted.id },
              data: {
                isDeleted: false,
                name: entry.name,
                entryType,
                mimeType,
                size: entryType === "FILE" ? BigInt(entry.size) : null,
              },
            });
            result.created += 1;
          } else {
            // Create new entry
            await prisma.fileEntry.create({
              data: {
                storageNodeId: node!.id,
                name: entry.name,
                entryType,
                mimeType,
                size: entryType === "FILE" ? BigInt(entry.size) : null,
                relativePath,
              },
            });
            result.created += 1;
          }
        }

        // If recursive and this is a directory, scan it too
        if (recursive && entryType === "DIRECTORY") {
          const childPath = dirPath.replace(/\/+$/, "") + "/" + entry.name;
          await syncDirectory(childPath, currentDepth + 1);
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : "未知错误";
        result.errors.push(`同步 ${relativePath} 失败：${msg}`);
      }
    }
  }

  try {
    await syncDirectory(normalizedRemotePath, 0);
  } catch {
    return NextResponse.json(
      toClientStorageError("同步过程出错，请检查节点配置或远端路径"),
      { status: 500 },
    );
  }

  return NextResponse.json(result);
}
