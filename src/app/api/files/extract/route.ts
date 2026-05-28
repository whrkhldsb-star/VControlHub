import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireSession } from "@/lib/auth/require-session";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import fs from "node:fs/promises";
import { sessionHasPermission } from "@/lib/auth/authorization";
import { resolveStoragePathWithinBase } from "@/lib/storage/path-utils";
import { withRateLimit, rateLimitResponse, GENERAL_WRITE_LIMIT } from "@/lib/http/rate-limit-presets";

const execFileAsync = promisify(execFile);

export const dynamic = "force-dynamic";

const postSchema = z.object({
	serverId: z.string().min(1),
	remotePath: z.string().min(1),
	targetDir: z.string().optional(),
	driver: z.string().optional(),
	name: z.string().optional(),
});

export async function POST(request: NextRequest) {
	const rl = withRateLimit(request, GENERAL_WRITE_LIMIT);
	if (!rl.allowed) return rateLimitResponse(rl.retryAfterMs);
	const session = await requireSession();
	if (!session) return NextResponse.json({ error: "未授权" }, { status: 401 });
	if (!sessionHasPermission(session, "storage:write")) {
		return NextResponse.json({ error: "缺少云盘写入权限" }, { status: 403 });
	}

	let rawBody: unknown;
	try {
		rawBody = await request.json();
	} catch {
		return NextResponse.json({ error: "无效请求体" }, { status: 400 });
	}

	const parsed = postSchema.safeParse(rawBody);
	if (!parsed.success) {
		return NextResponse.json({ error: "输入参数无效" }, { status: 400 });
	}

	const body = parsed.data;
	const driver = body.driver ?? "LOCAL";
	const name = body.name ?? "archive";
	const nodeId = body.serverId;
	const relativePath = body.remotePath;

	if (driver !== "LOCAL") {
		return NextResponse.json(
			{ error: "仅支持本地存储节点的压缩包在线解压" },
			{ status: 400 },
		);
	}

	if (!nodeId || !relativePath) {
		return NextResponse.json({ error: "缺少必要参数" }, { status: 400 });
	}

	// Find storage node basePath
	const { prisma } = await import("@/lib/db");
	const node = await prisma.storageNode.findUnique({ where: { id: nodeId }, select: { id: true, name: true, driver: true, basePath: true } });
	if (!node) {
		return NextResponse.json({ error: "存储节点不存在" }, { status: 404 });
	}

	const resolvedPath = resolveStoragePathWithinBase(node.basePath, relativePath.replace(/^\/+/, ""));
	if (!resolvedPath.ok) {
		return NextResponse.json({ error: resolvedPath.reason }, { status: 400 });
	}
	const fullPath = resolvedPath.path;
	// Verify the file exists
	try {
		await fs.access(fullPath);
	} catch {
		return NextResponse.json({ error: "文件不存在" }, { status: 404 });
	}

	const lowerName = name.toLowerCase();
	const ext = path.extname(lowerName);

	try {
		if (ext === ".gz" && !lowerName.endsWith(".tar.gz")) {
			const outputName = name.replace(/\.gz$/, "");
			const outputPath = resolveStoragePathWithinBase(node.basePath, path.posix.join(path.posix.dirname(relativePath.replace(/^\/+/, "")), outputName));
			if (!outputPath.ok) {
				return NextResponse.json({ error: outputPath.reason }, { status: 400 });
			}
			await execFileAsync("gunzip", ["-k", "-f", fullPath], {
				maxBuffer: 10 * 1024 * 1024,
				timeout: 60000,
			});
		} else if (ext === ".zip" || ext === ".jar") {
			return NextResponse.json(
				{ error: "为避免符号链接/硬链接穿越风险，暂不支持在线解压 zip/jar，请先在可信环境中解压" },
				{ status: 400 },
			);
		} else if (lowerName.endsWith(".tar.gz") || lowerName.endsWith(".tgz")) {
			return NextResponse.json(
				{ error: "为避免符号链接/硬链接穿越风险，暂不支持在线解压 tar/tgz，请先在可信环境中解压" },
				{ status: 400 },
			);
		} else if (ext === ".tar") {
			return NextResponse.json(
				{ error: "为避免符号链接/硬链接穿越风险，暂不支持在线解压 tar，请先在可信环境中解压" },
				{ status: 400 },
			);
		} else if (ext === ".7z" || ext === ".rar") {
			return NextResponse.json(
				{ error: "为避免符号链接/硬链接穿越风险，暂不支持在线解压 7z/RAR，请先在可信环境中解压" },
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
		return NextResponse.json({ error: `解压失败: ${message}` }, { status: 500 });
	}
}
