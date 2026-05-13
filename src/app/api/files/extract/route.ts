import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/require-session";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import fs from "node:fs/promises";

const execFileAsync = promisify(execFile);

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
	const session = await requireSession();
	if (!session) return NextResponse.json({ error: "未授权" }, { status: 401 });

	let body: { nodeId?: string; relativePath?: string; driver?: string; name?: string };
	try {
		body = await request.json();
	} catch {
		return NextResponse.json({ error: "无效请求体" }, { status: 400 });
	}

	const { nodeId, relativePath, driver = "LOCAL", name = "archive" } = body;

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

	const fullPath = path.join(node.basePath, relativePath.replace(/^\/+/, ""));
	const targetDir = path.dirname(fullPath);

	// Verify the file exists
	try {
		await fs.access(fullPath);
	} catch {
		return NextResponse.json({ error: "文件不存在" }, { status: 404 });
	}

	const ext = path.extname(name).toLowerCase();

	try {
		if (ext === ".zip" || ext === ".jar") {
			await execFileAsync("unzip", ["-o", fullPath, "-d", targetDir], {
				maxBuffer: 10 * 1024 * 1024,
				timeout: 60000,
			});
		} else if (ext === ".tar.gz" || ext === ".tgz") {
			await execFileAsync("tar", ["-xzf", fullPath, "-C", targetDir], {
				maxBuffer: 10 * 1024 * 1024,
				timeout: 60000,
			});
		} else if (ext === ".tar") {
			await execFileAsync("tar", ["-xf", fullPath, "-C", targetDir], {
				maxBuffer: 10 * 1024 * 1024,
				timeout: 60000,
			});
		} else if (ext === ".gz" && !name.endsWith(".tar.gz")) {
			const outputName = name.replace(/\.gz$/, "");
			const outputPath = path.join(targetDir, outputName);
			await execFileAsync("gunzip", ["-k", "-f", fullPath], {
				maxBuffer: 10 * 1024 * 1024,
				timeout: 60000,
			});
		} else if (ext === ".7z") {
			await execFileAsync("7z", ["x", fullPath, `-o${targetDir}`, "-y"], {
				maxBuffer: 10 * 1024 * 1024,
				timeout: 60000,
			});
		} else if (ext === ".rar") {
			await execFileAsync("unrar", ["x", "-y", fullPath, targetDir + "/"], {
				maxBuffer: 10 * 1024 * 1024,
				timeout: 60000,
			});
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
