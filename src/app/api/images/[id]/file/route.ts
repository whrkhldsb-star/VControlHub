import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import path from "node:path";

import { NextResponse } from "next/server";

import { getApiSession } from "@/lib/auth/api-session";
import { sessionHasPermission } from "@/lib/auth/authorization";
import { prisma } from "@/lib/db";
import { UPLOAD_DIR } from "@/lib/image-bed/constants";

import { apiError } from "@/lib/http/api-error";
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
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;

    const image = await prisma.imageUpload.findUnique({
      where: { id },
      select: {
        id: true,
        storageKey: true,
        mimeType: true,
        filename: true,
        isPublic: true,
        userId: true,
      },
    });

    if (!image) {
      return NextResponse.json(
        { error: "图片不存在或不可访问" },
        { status: 404 },
      );
    }

    if (!image.isPublic) {
      const session = await getApiSession();
      const canReadPrivateImage =
        !!session &&
        (session.userId === image.userId ||
          sessionHasPermission(session, "image:read"));

      if (!canReadPrivateImage) {
        return NextResponse.json(
          { error: "图片不存在或不可访问" },
          { status: 404 },
        );
      }
    }

    const filePath = resolveUploadPath(image.storageKey);
    if (!filePath) {
      return apiError({ code: "VALIDATION_FAILED", message: "文件路径无效", status: 400 });
    }

    let fileStat;
    try {
      fileStat = await stat(filePath);
    } catch {
      return apiError({ code: "NOT_FOUND", message: "文件已丢失", status: 404 });
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
      cancel() {
        stream.destroy();
      },
    });

    return new NextResponse(webStream, {
      status: 200,
      headers: {
        "Content-Type": image.mimeType,
        "Content-Length": String(fileStat.size),
        "Cache-Control": image.isPublic
          ? "public, max-age=31536000, immutable"
          : "private, no-store",
        "Content-Disposition": `inline; filename="${image.filename.replace(/["\r\n]/g, "_")}"`,
      },
    });
  } catch {
    return apiError({ code: "INTERNAL_ERROR", message: "获取图片失败", status: 500 });
  }
}
