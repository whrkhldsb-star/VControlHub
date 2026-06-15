import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import fs from "node:fs/promises";
import { resolveStoragePathWithinBase } from "@/lib/storage/path-utils";
import { withApiRoute } from "@/lib/http/api-guard";
import { GENERAL_WRITE_LIMIT } from "@/lib/http/rate-limit-presets";
import { assertStorageAccess } from "@/lib/storage/access-control";
import { prisma } from "@/lib/db";
import { createFileEntry } from "@/lib/storage/service";

import { AuthError, NotFoundError, ValidationError } from "@/lib/errors";
const execFileAsync = promisify(execFile);

export const dynamic = "force-dynamic";

const postSchema = z
  .object({
    storageNodeId: z.string().min(1).optional(),
    serverId: z.string().min(1).optional(),
    remotePath: z.string().min(1),
    targetDir: z.string().optional(),
    driver: z.string().optional(),
    name: z.string().optional(),
  })
  .refine((value) => value.storageNodeId || value.serverId, {
    message: "缺少 storageNodeId",
    path: ["storageNodeId"],
  });

export async function POST(request: NextRequest) {
  return withApiRoute(
    request,
    {
      permission: "storage:write",
      rateLimit: GENERAL_WRITE_LIMIT,
      errorMessage: "解压失败",
    },
    async ({ session }) => {
      if (!session)
        throw new AuthError("未授权");

      let rawBody: unknown;
      try {
        rawBody = await request.json();
      } catch {
        throw new ValidationError("无效请求体");
      }

      const parsed = postSchema.safeParse(rawBody);
      if (!parsed.success) {
        throw new ValidationError("输入参数无效");
      }

      const body = parsed.data;
      const driver = body.driver ?? "LOCAL";
      const name = body.name ?? "archive";
      const nodeId = body.storageNodeId ?? body.serverId;
      const relativePath = body.remotePath.replace(/^\/+/, "");

      if (driver !== "LOCAL") {
        return NextResponse.json(
          { error: "仅支持本地存储节点的压缩包在线解压" },
          { status: 400 },
        );
      }

      if (!nodeId || !relativePath) {
        throw new ValidationError("缺少必要参数");
      }

      const node = await prisma.storageNode.findUnique({
        where: { id: nodeId },
        select: { id: true, name: true, driver: true, basePath: true },
      });
      if (!node) {
        throw new NotFoundError("存储节点不存在");
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
          { error: accessDecision.reason ?? "没有该存储节点或路径的访问授权" },
          { status: 403 },
        );
      }

      const writeAccessDecision = await assertStorageAccess({
        session,
        storageNodeId: node.id,
        relativePath:
          body.targetDir?.trim() || path.posix.dirname(relativePath),
        operation: "write",
      });
      if (!writeAccessDecision.allowed) {
        return NextResponse.json(
          {
            error:
              writeAccessDecision.reason ??
              "没有该存储节点或目标目录的写入授权",
          },
          { status: 403 },
        );
      }

      const fullPath = resolvedPath.path;
      // Verify the file exists
      try {
        await fs.access(fullPath);
      } catch {
        throw new NotFoundError("文件不存在");
      }

      const lowerName = name.toLowerCase();
      const ext = path.extname(lowerName);

      try {
        if (ext === ".gz" && !lowerName.endsWith(".tar.gz")) {
          const outputName = name.replace(/\.gz$/i, "");
          const outputRelativePath = path.posix.join(
            path.posix.dirname(relativePath),
            outputName,
          );
          const outputPath = resolveStoragePathWithinBase(
            node.basePath,
            outputRelativePath,
          );
          if (!outputPath.ok) {
            return NextResponse.json(
              { error: outputPath.reason },
              { status: 400 },
            );
          }

          const existingOutput = await prisma.fileEntry.findFirst({
            where: {
              storageNodeId: node.id,
              relativePath: outputRelativePath,
              isDeleted: false,
            },
            select: { id: true },
          });
          if (existingOutput) {
            return NextResponse.json(
              { error: `目标文件 /${outputRelativePath} 已存在` },
              { status: 409 },
            );
          }

          try {
            await fs.access(outputPath.path);
            return NextResponse.json(
              { error: `目标文件 /${outputRelativePath} 已存在` },
              { status: 409 },
            );
          } catch {
            // Expected: gunzip should create this file.
          }

          await execFileAsync("gunzip", ["-k", fullPath], {
            maxBuffer: 10 * 1024 * 1024,
            timeout: 60000,
          });

          let outputStat;
          try {
            outputStat = await fs.stat(outputPath.path);
          } catch {
            return NextResponse.json(
              { error: "解压命令完成但未找到输出文件" },
              { status: 500 },
            );
          }

          try {
            await createFileEntry({
              storageNodeId: node.id,
              name: outputName,
              entryType: "FILE",
              mimeType: "application/octet-stream",
              size: outputStat.size,
              relativePath: outputRelativePath,
            });
          } catch (error) {
            try {
              await fs.unlink(outputPath.path);
            } catch {
              // Best-effort cleanup: keep the original indexing error visible.
            }
            throw error;
          }
        } else if (ext === ".zip" || ext === ".jar") {
          return NextResponse.json(
            {
              error:
                "为避免符号链接/硬链接穿越风险，暂不支持在线解压 zip/jar，请先在可信环境中解压",
            },
            { status: 400 },
          );
        } else if (
          lowerName.endsWith(".tar.gz") ||
          lowerName.endsWith(".tgz")
        ) {
          return NextResponse.json(
            {
              error:
                "为避免符号链接/硬链接穿越风险，暂不支持在线解压 tar/tgz，请先在可信环境中解压",
            },
            { status: 400 },
          );
        } else if (ext === ".tar") {
          return NextResponse.json(
            {
              error:
                "为避免符号链接/硬链接穿越风险，暂不支持在线解压 tar，请先在可信环境中解压",
            },
            { status: 400 },
          );
        } else if (ext === ".7z" || ext === ".rar") {
          return NextResponse.json(
            {
              error:
                "为避免符号链接/硬链接穿越风险，暂不支持在线解压 7z/RAR，请先在可信环境中解压",
            },
            { status: 400 },
          );
        } else {
          return NextResponse.json(
            { error: `不支持的压缩包格式: ${ext}` },
            { status: 400 },
          );
        }

        return NextResponse.json({
          message: `已将 ${name} 解压到当前目录，请刷新文件列表查看`,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : "解压失败";
        return NextResponse.json(
          { error: `解压失败: ${message}` },
          { status: 500 },
        );
      }
    },
  );
}
