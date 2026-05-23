/**
 * Publish a file from storage node to image bed.
 * POST /api/images/publish-from-storage
 * Body: { storageNodeId, relativePath, filename?, album? }
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { getApiSession } from "@/lib/auth/api-session";
import { sessionHasPermission } from "@/lib/auth/authorization";
import { prisma } from "@/lib/db";
import { writeFile, mkdir, readFile } from "node:fs/promises";
import * as path from "node:path";
import * as crypto from "node:crypto";
import { createLogger } from "@/lib/logging";
import { UPLOAD_DIR, IMAGE_EXTENSIONS, mimeTypeFromExt } from "@/lib/image-bed/constants";
import { withRateLimit, rateLimitResponse, IMAGE_UPLOAD_LIMIT } from "@/lib/http/rate-limit-presets";
import { resolveStoragePathWithinBase } from "@/lib/storage/path-utils";

const logger = createLogger("api:images:publish-from-storage");

const publishSchema = z.object({ storageNodeId: z.string().min(1), relativePath: z.string().min(1), filename: z.string().optional(), album: z.string().optional() });

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
	const rl = withRateLimit(request, IMAGE_UPLOAD_LIMIT);
	if (!rl.allowed) return rateLimitResponse(rl.retryAfterMs);
	try {
		const session = await getApiSession();
		if (!session) {
			return NextResponse.json({ error: "未登录或会话已过期" }, { status: 401 });
		}
		if (!sessionHasPermission(session, "storage:read")) {
			return NextResponse.json({ error: "缺少云盘读取权限" }, { status: 403 });
		}

		const parsed = publishSchema.safeParse(await request.json());
		if (!parsed.success) return NextResponse.json({ error: "输入参数无效" }, { status: 400 });
		const { storageNodeId, relativePath, filename, album } = parsed.data;

		// Verify the storage node exists and is accessible
		const storageNode = await prisma.storageNode.findUnique({
			where: { id: storageNodeId },
			select: { id: true, driver: true, basePath: true },
		});
		if (!storageNode || storageNode.driver !== "LOCAL") {
			return NextResponse.json({ error: "仅支持本地存储节点" }, { status: 400 });
		}

		const resolvedSourcePath = resolveStoragePathWithinBase(storageNode.basePath, relativePath);
		if (!resolvedSourcePath.ok) {
			return NextResponse.json({ error: resolvedSourcePath.reason }, { status: 400 });
		}
		const sourcePath = resolvedSourcePath.path;
		const ext = path.extname(relativePath).toLowerCase();
		if (!IMAGE_EXTENSIONS.has(ext)) {
			return NextResponse.json({ error: "不支持该文件类型" }, { status: 400 });
		}

		// Read file from storage
		const buffer = await readFile(sourcePath);
		const originalName = filename || path.basename(relativePath);
		const storageKey = `${crypto.randomUUID()}${ext}`;
		const checksum = crypto.createHash("sha256").update(buffer).digest("hex");

		// Check for duplicate
		const existing = await prisma.imageUpload.findFirst({ where: { checksum } });
		if (existing) {
			return NextResponse.json({
				image: existing,
				publicUrl: `/api/images/${existing.id}/file`,
				message: "文件已存在（checksum 匹配），跳过上传",
			});
		}

		// Save to image-bed directory
		await mkdir(UPLOAD_DIR, { recursive: true });
		await writeFile(path.join(UPLOAD_DIR, storageKey), buffer);

		// Create DB record
		const image = await prisma.imageUpload.create({
			data: {
				filename: originalName,
				storageKey,
				mimeType: mimeTypeFromExt(ext),
				sizeBytes: buffer.byteLength,
				checksum,
				album: album?.trim() || undefined,
				isPublic: true,
				storageNodeId,
				relativePath,
				userId: session.userId,
			},
		});

		return NextResponse.json({
			image,
			publicUrl: `/api/images/${image.id}/file`,
		}, { status: 201 });
	} catch (error) {
		logger.error("[images/publish-from-storage]", error);
		return NextResponse.json({ error: "从云盘发布失败" }, { status: 500 });
	}
}
