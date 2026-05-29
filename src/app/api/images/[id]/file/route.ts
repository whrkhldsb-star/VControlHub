import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import path from "node:path";

import { NextResponse } from "next/server";

import { prisma } from "@/lib/db";
import { withApiRoute } from "@/lib/http/api-guard";
import { UPLOAD_DIR } from "@/lib/image-bed/constants";

export const dynamic = "force-dynamic";

function resolveUploadPath(storageKey: string) {
  const uploadRoot = path.resolve(UPLOAD_DIR);
  const filePath = path.resolve(uploadRoot, storageKey);
  if (
    filePath !== uploadRoot &&
    filePath.startsWith(`${uploadRoot}${path.sep}`)
  ) {
    return filePath;
  }
  return null;
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return withApiRoute(
    request,
    { requireAuth: true, errorMessage: "获取图片失败" },
    async () => {
      const { id } = await params;

      const image = await prisma.imageUpload.findUnique({
        where: { id },
        select: {
          id: true,
          storageKey: true,
          mimeType: true,
          filename: true,
          isPublic: true,
        },
      });

      if (!image || !image.isPublic) {
        return NextResponse.json(
          { error: "图片不存在或不可公开访问" },
          { status: 404 },
        );
      }

      const filePath = resolveUploadPath(image.storageKey);
      if (!filePath) {
        return NextResponse.json({ error: "文件路径无效" }, { status: 400 });
      }

      let fileStat;
      try {
        fileStat = await stat(filePath);
      } catch {
        return NextResponse.json({ error: "文件已丢失" }, { status: 404 });
      }

      const stream = createReadStream(filePath);
      const webStream = new ReadableStream({
        start(controller) {
          stream.on("data", (chunk) =>
            controller.enqueue(new Uint8Array(chunk as Buffer)),
          );
          stream.on("end", () => controller.close());
          stream.on("error", (err) => controller.error(err));
        },
      });

      return new NextResponse(webStream, {
        status: 200,
        headers: {
          "Content-Type": image.mimeType,
          "Content-Length": String(fileStat.size),
          "Cache-Control": "public, max-age=31536000, immutable",
          "Content-Disposition": `inline; filename="${image.filename.replace(/["\r\n]/g, "_")}"`,
        },
      });
    },
  );
}
