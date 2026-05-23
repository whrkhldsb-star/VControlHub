import { writeFile, mkdir } from "node:fs/promises";
import * as path from "node:path";
import * as crypto from "node:crypto";

import { NextResponse } from "next/server";
import { getApiSession } from "@/lib/auth/api-session";
import { sessionHasPermission } from "@/lib/auth/authorization";
import { verifyBearerToken } from "@/lib/auth/bearer-token";
import { prisma } from "@/lib/db";
import { logError } from "@/lib/logging";
import { extractMetadata, generateThumbnail, convertToWebP, convertToAVIF } from "@/lib/image/service";
import { UPLOAD_DIR } from "@/lib/image-bed/constants";
import { withRateLimit, rateLimitResponse, IMAGE_UPLOAD_LIMIT } from "@/lib/http/rate-limit-presets";
import { resolveStoragePathWithinBase } from "@/lib/storage/path-utils";

export const dynamic = "force-dynamic";
const MAX_FILE_SIZE = 20 * 1024 * 1024; // 20 MB
const ALLOWED_MIME_PREFIXES = ["image/"];

function generateStorageKey(originalName: string): string {
	const ext = path.extname(originalName).toLowerCase() || ".png";
	return `${crypto.randomUUID()}${ext}`;
}

function computeChecksum(buffer: Buffer): string {
	return crypto.createHash("sha256").update(buffer).digest("hex");
}

type UploadFile = {
	arrayBuffer(): Promise<ArrayBuffer>;
	name?: string;
	type?: string;
	size?: number;
};

function isUploadFile(v: unknown): v is UploadFile {
	return !!v && typeof v === "object" && typeof (v as UploadFile).arrayBuffer === "function";
}

export async function POST(request: Request) {
	const rl = withRateLimit(request, IMAGE_UPLOAD_LIMIT);
	if (!rl.allowed) return rateLimitResponse(rl.retryAfterMs);
	try {
		// Support Bearer Token auth (for API clients) OR session cookie
		const tokenAuth = await verifyBearerToken(request, "image:write");
		let userId: string;
		if (tokenAuth) {
			userId = tokenAuth.userId;
		} else {
			const session = await getApiSession();
			if (!session) {
				return NextResponse.json({ error: "未登录或会话已过期" }, { status: 401 });
			}
			if (!sessionHasPermission(session, "storage:write")) {
				return NextResponse.json({ error: "缺少权限" }, { status: 403 });
			}
			userId = session.userId;
		}

		const formData = await request.formData();
		const file = formData.get("file");
		const album = String(formData.get("album") ?? "").trim() || undefined;
		const storageNodeId = String(formData.get("storageNodeId") ?? "").trim() || undefined;
		const relativePath = String(formData.get("relativePath") ?? "").trim() || undefined;

		if (!isUploadFile(file)) {
			return NextResponse.json({ error: "缺少上传文件" }, { status: 400 });
		}

		const mimeType = file.type || "application/octet-stream";
		if (!ALLOWED_MIME_PREFIXES.some((p) => mimeType.startsWith(p))) {
			return NextResponse.json({ error: "仅支持上传图片文件" }, { status: 400 });
		}

		const buffer = Buffer.from(await file.arrayBuffer());
		if (buffer.byteLength > MAX_FILE_SIZE) {
			return NextResponse.json({ error: "文件大小超过 20MB 限制" }, { status: 400 });
		}

		const originalName = file.name || "untitled.png";
		const storageKey = generateStorageKey(originalName);
		const checksum = computeChecksum(buffer);

		// Extract image metadata and generate thumbnail using sharp
		let imgWidth: number | null = null;
		let imgHeight: number | null = null;
		try {
			const meta = await extractMetadata(buffer);
			imgWidth = meta.width || null;
			imgHeight = meta.height || null;
		} catch {
			// Not a valid image or sharp can't process — still save as-is
		}

		// Ensure upload directory exists
		const uploadDir = UPLOAD_DIR;
		await mkdir(uploadDir, { recursive: true });

		// Save original + generate thumbnail + WebP/AVIF variants
		const ext = path.extname(storageKey).toLowerCase();
		const base = path.basename(storageKey, ext);
		const thumbName = `${base}_thumb.webp`;

		await Promise.all([
			writeFile(path.join(uploadDir, storageKey), buffer),
			// Generate thumbnail (best-effort)
			(async () => {
				try {
					const thumb = await generateThumbnail(buffer);
					await writeFile(path.join(uploadDir, thumbName), thumb);
				} catch { /* best-effort */ }
			})(),
			// Generate WebP variant (best-effort)
			(async () => {
				try {
					if (!mimeType.includes("webp")) {
						const webp = await convertToWebP(buffer);
						await writeFile(path.join(uploadDir, `${base}.webp`), webp);
					}
				} catch { /* best-effort */ }
			})(),
			// Generate AVIF variant (best-effort)
			(async () => {
				try {
					if (!mimeType.includes("avif")) {
						const avif = await convertToAVIF(buffer);
						await writeFile(path.join(uploadDir, `${base}.avif`), avif);
					}
				} catch { /* best-effort */ }
			})(),
		]);

		// If linked to a storage node, also copy there (cloud storage integration)
		if (storageNodeId && relativePath) {
			try {
				const storageNode = await prisma.storageNode.findUnique({
					where: { id: storageNodeId },
					select: { id: true, driver: true, basePath: true },
				});
				if (storageNode && storageNode.driver === "LOCAL") {
					const resolvedPath = resolveStoragePathWithinBase(storageNode.basePath, relativePath);
					if (!resolvedPath.ok) {
						return NextResponse.json({ error: resolvedPath.reason }, { status: 400 });
					}
					await mkdir(resolvedPath.path, { recursive: true });
					await writeFile(path.join(resolvedPath.path, storageKey), buffer);
				}
			} catch (e) {
				// Non-fatal: cloud copy is best-effort
				logError("image-bed:cloud-copy-failed", e);
			}
		}

		// Create DB record
		const image = await prisma.imageUpload.create({
			data: {
				filename: originalName,
				storageKey,
				mimeType,
				sizeBytes: buffer.byteLength,
				width: imgWidth,
				height: imgHeight,
				checksum,
				album,
				isPublic: true,
				storageNodeId: storageNodeId || undefined,
				relativePath: relativePath || undefined,
				userId: userId,
			},
		});

		const publicUrl = `/api/images/${image.id}/file`;

		return NextResponse.json(
			{
				...image,
				publicUrl,
			},
			{ status: 201 },
		);
	} catch (error) {
		logError("image-bed:upload", error);
		return NextResponse.json({ error: "上传失败" }, { status: 500 });
	}
}
