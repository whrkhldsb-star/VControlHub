import { NextResponse } from "next/server";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import path from "node:path";

import { buildContentDisposition } from "@/lib/http/content-disposition";
import { nodeStreamToWeb } from "@/lib/http/node-to-web-stream";
import { resolveShareToken } from "@/lib/share-link/service";

export const dynamic = "force-dynamic";

function guessContentType(fileName: string): string {
	const ext = path.extname(fileName).toLowerCase();
	if ([".jpg", ".jpeg"].includes(ext)) return "image/jpeg";
	if (ext === ".png") return "image/png";
	if (ext === ".webp") return "image/webp";
	if (ext === ".gif") return "image/gif";
	if (ext === ".svg") return "image/svg+xml";
	if (ext === ".mp4") return "video/mp4";
	if (ext === ".webm") return "video/webm";
	if (ext === ".mp3") return "audio/mpeg";
	if (ext === ".wav") return "audio/wav";
	if (ext === ".pdf") return "application/pdf";
	if (ext === ".txt") return "text/plain; charset=utf-8";
	return "application/octet-stream";
}

/**
 * Public share-link file access.
 * No authentication required — the share token itself is the credential.
 */
export async function GET(
	_request: Request,
	{ params }: { params: Promise<{ token: string }> },
) {
	const { token } = await params;

	if (!token || token.length < 10) {
		return NextResponse.json({ error: "分享链接无效" }, { status: 400 });
	}

	let share: Awaited<ReturnType<typeof resolveShareToken>>;
	try {
		share = await resolveShareToken(token);
	} catch (err) {
		const message = err instanceof Error ? err.message : "分享链接无效";
		return NextResponse.json({ error: message }, { status: 404 });
	}

	const node = share.storageNode;

	// Only LOCAL storage nodes support direct HTTP serving for now
	if (node.driver !== "LOCAL") {
		return NextResponse.json(
			{ error: "该分享链接指向远端存储节点，暂不支持公开直接访问；请通过 SFTP 中转下载" },
			{ status: 400 },
		);
	}

	const allowedRoot = path.resolve(node.basePath);
	const absolutePath = path.resolve(allowedRoot, share.path);
	const relativeToRoot = path.relative(allowedRoot, absolutePath);

	if (relativeToRoot.startsWith("..") || path.isAbsolute(relativeToRoot)) {
		return NextResponse.json({ error: "非法路径" }, { status: 400 });
	}

	try {
		await stat(absolutePath);
		const fileStat = await stat(absolutePath);
		if (!fileStat.isFile()) {
			return NextResponse.json({ error: "分享目标不是可下载文件" }, { status: 400 });
		}

		const nodeStream = createReadStream(absolutePath);
		const body = nodeStreamToWeb(nodeStream);

		const headers = new Headers();
		headers.set("content-type", guessContentType(share.name || share.path));
		headers.set("content-length", String(fileStat.size));
		headers.set("cache-control", "private, no-store");
		headers.set(
			"content-disposition",
			buildContentDisposition("attachment", share.name || share.path),
		);

		return new Response(body, { status: 200, headers });
	} catch {
		return NextResponse.json({ error: "文件不存在或暂时无法读取" }, { status: 404 });
	}
}
