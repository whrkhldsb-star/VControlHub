import crypto from "node:crypto";

import { NextResponse } from "next/server";
import { z } from "zod";
import { sessionHasPermission } from "@/lib/auth/authorization";
import { requireSession } from "@/lib/auth/require-session";

import { prisma } from "@/lib/db";
import { assertStorageAccess } from "@/lib/storage/access-control";
import { normalizeRemoteTargetPath } from "@/lib/storage/remote-path";
import { withRateLimit, rateLimitResponse, UPLOAD_LIMIT } from "@/lib/http/rate-limit-presets";

export const dynamic = "force-dynamic";

const directAccessSchema = z.object({ nodeId: z.string().min(1), relativePath: z.string().min(1) });

type DirectAccessPayload =
	| { mode: "managed-download"; fallbackUrl: string }
	| { mode: "direct-url"; url: string; fallbackUrl: string; expiresSeconds: number };

function fallbackUrl(nodeId: string, relativePath: string) {
	const params = new URLSearchParams({ nodeId, path: relativePath });
	return `/api/storage/sftp-download?${params.toString()}`;
}

function getDirectAccessSecret() {
	return process.env.STORAGE_DIRECT_ACCESS_SECRET || process.env.AUTH_SECRET || process.env.NEXTAUTH_SECRET || "";
}

function buildSignedDirectUrl(input: { publicBaseUrl: string; relativePath: string; expiresSeconds: number }) {
	const base = input.publicBaseUrl.endsWith("/") ? input.publicBaseUrl : `${input.publicBaseUrl}/`;
	const relativeSegments = input.relativePath.split("/").filter(Boolean).map((segment) => encodeURIComponent(segment));
	const url = new URL(relativeSegments.join("/"), base);
	const expires = Math.floor(Date.now() / 1000) + input.expiresSeconds;
	const secret = getDirectAccessSecret();

	if (!secret) {
		throw new Error("未配置直连签名密钥 STORAGE_DIRECT_ACCESS_SECRET");
	}

	const signedPath = `/${relativeSegments.join("/")}`;
	const signature = crypto.createHmac("sha256", secret).update(`${signedPath}.${expires}`).digest("hex");
	url.searchParams.set("expires", String(expires));
	url.searchParams.set("signature", signature);
	return url.toString();
}

async function resolveDirectAccessPayload(input: { nodeId: string; relativePath: string; session: Awaited<ReturnType<typeof requireSession>> }): Promise<DirectAccessPayload | NextResponse> {
	const { nodeId, relativePath, session } = input;
	const node = await prisma.storageNode.findUnique({
		where: { id: nodeId },
		select: { basePath: true, driver: true, directAccessMode: true, publicBaseUrl: true, directAccessExpiresSeconds: true },
	});

	if (!node) {
		return NextResponse.json({ error: "存储节点不存在" }, { status: 404 });
	}

	try {
		normalizeRemoteTargetPath(node.basePath, relativePath);
	} catch {
		return NextResponse.json({ error: "请求路径超出存储节点根目录" }, { status: 400 });
	}

	const fallback = fallbackUrl(nodeId, relativePath);
	const access = await assertStorageAccess({ session, storageNodeId: nodeId, relativePath, operation: "read" });
	if (!access.allowed) {
		return NextResponse.json({ error: access.reason }, { status: 403 });
	}

	if (node.driver !== "SFTP") {
		return { mode: "managed-download", fallbackUrl: fallback };
	}

	if (node.directAccessMode === "DIRECT" || node.directAccessMode === "AUTO") {
		if (node.publicBaseUrl) {
			try {
				return {
					mode: "direct-url",
					url: buildSignedDirectUrl({
						publicBaseUrl: node.publicBaseUrl,
						relativePath,
						expiresSeconds: node.directAccessExpiresSeconds ?? 300,
					}),
					fallbackUrl: fallback,
					expiresSeconds: node.directAccessExpiresSeconds ?? 300,
				};
			} catch (error) {
				if (node.directAccessMode === "DIRECT") {
					const message = error instanceof Error ? error.message : "生成直连链接失败";
					return NextResponse.json({ error: message, mode: "managed-download", fallbackUrl: fallback }, { status: 500 });
				}
			}
		}
	}

	return { mode: "managed-download", fallbackUrl: fallback };
}

function parseDirectAccessJson(body: unknown) {
	return directAccessSchema.safeParse(body);
}

function parseDirectAccessQuery(request: Request) {
	const url = new URL(request.url);
	return directAccessSchema.safeParse({
		nodeId: url.searchParams.get("nodeId") ?? "",
		relativePath: url.searchParams.get("relativePath") || url.searchParams.get("path") || "",
	});
}

export async function GET(request: Request) {
	const session = await requireSession();
	if (!sessionHasPermission(session, "storage:read")) {
		return NextResponse.json({ error: "无权限" }, { status: 403 });
	}

	const parsed = parseDirectAccessQuery(request);
	if (!parsed.success) return NextResponse.json({ error: "缺少 nodeId 或 relativePath" }, { status: 400 });

	const payload = await resolveDirectAccessPayload({ ...parsed.data, session });
	if (payload instanceof NextResponse) return payload;

	const redirectUrl = payload.mode === "direct-url" ? payload.url : payload.fallbackUrl;
	return NextResponse.redirect(new URL(redirectUrl, request.url), { status: 302 });
}

export async function POST(request: Request) {
	const rl = withRateLimit(request, UPLOAD_LIMIT);
	if (!rl.allowed) return rateLimitResponse(rl.retryAfterMs);
	const session = await requireSession();
	if (!sessionHasPermission(session, "storage:read")) {
		return NextResponse.json({ error: "无权限" }, { status: 403 });
	}

	const parsed = parseDirectAccessJson(await request.json());
	if (!parsed.success) return NextResponse.json({ error: "缺少 nodeId 或 relativePath" }, { status: 400 });

	const payload = await resolveDirectAccessPayload({ ...parsed.data, session });
	if (payload instanceof NextResponse) return payload;
	return NextResponse.json(payload);
}

export async function DELETE(request: Request) {
	const rl = withRateLimit(request, UPLOAD_LIMIT);
	if (!rl.allowed) return rateLimitResponse(rl.retryAfterMs);
	try {
		const session = await requireSession();
		if (!sessionHasPermission(session, "storage:read")) {
			return NextResponse.json({ error: "无权限" }, { status: 403 });
		}

		return NextResponse.json({ stopped: true, mode: "managed-download" });
	} catch (error) {
		const message = error instanceof Error ? error.message : "操作失败";
		return NextResponse.json({ error: message }, { status: 500 });
	}
}
