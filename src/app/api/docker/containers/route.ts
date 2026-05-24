/**
 * Docker containers API — list, inspect, start/stop/restart, logs.
 * Uses Docker Engine API via Node.js HTTP over unix socket /var/run/docker.sock
 * Zero child_process calls — pure Node.js HTTP, no curl, no injection risk.
 *
 * GET /api/docker/containers — list containers
 * GET /api/docker/containers?id=xxx — inspect one container
 * POST /api/docker/containers — start/stop/restart {id, action}
 * GET /api/docker/containers?logs=xxx — get container logs
 */
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import http from "node:http";
import { requireApiSession, isSessionPayload } from "@/lib/auth/api-session";
import { createLogger } from "@/lib/logging";
import { sessionHasPermission } from "@/lib/auth/authorization";
import { withRateLimit, rateLimitResponse, COMMAND_LIMIT } from "@/lib/http/rate-limit-presets";
import { parseDockerStats } from "@/lib/docker/stats";

const logger = createLogger("api:docker:containers");

const containerActionSchema = z.object({ id: z.string().min(1), action: z.enum(["start", "stop", "restart", "remove"]) });

const DOCKER_SOCKET = "/var/run/docker.sock";
const DOCKER_API_HOST = "localhost";

/** Validate Docker container ID: only allow hex chars and names (alphanumeric + _.-) */
function isValidDockerId(value: string): boolean {
	return /^[a-zA-Z0-9_.-]+$/.test(value) && value.length <= 128;
}

/** Validate tail parameter: only allow positive integers */
function isValidTail(value: string): boolean {
	return /^\d{1,5}$/.test(value) && parseInt(value, 10) <= 50000;
}

/**
 * Call Docker Engine API via Node.js HTTP over unix socket.
 * No curl, no child_process — pure Node.js http.request.
 */
function dockerRequest(apiPath: string, method = "GET", body?: string): Promise<{ ok: boolean; status: number; data: unknown }> {
	return new Promise((resolve) => {
		const options: http.RequestOptions = {
			socketPath: DOCKER_SOCKET,
			path: apiPath,
			method,
			host: DOCKER_API_HOST,
			headers: body
				? { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) }
				: {},
			timeout: 10000,
		};

		const req = http.request(options, (res) => {
			const chunks: Buffer[] = [];
			res.on("data", (chunk: Buffer) => chunks.push(chunk));
			res.on("end", () => {
				const raw = Buffer.concat(chunks).toString("utf-8");
				let data: unknown;
				try { data = JSON.parse(raw); } catch { data = raw; }
				resolve({ ok: res.statusCode! >= 200 && res.statusCode! < 300, status: res.statusCode!, data });
			});
		});

		req.on("error", (err) => {
			logger.error("Docker socket request failed", err, { apiPath, method });
			resolve({ ok: false, status: 502, data: { message: "Docker daemon unreachable" } });
		});

		req.on("timeout", () => {
			req.destroy();
			resolve({ ok: false, status: 504, data: { message: "Docker API timeout" } });
		});

		if (body) req.write(body);
		req.end();
	});
}

export async function GET(req: NextRequest) {
	const session = await requireApiSession();
	if (!isSessionPayload(session)) return session; // 401 response
	if (!sessionHasPermission(session, "docker:manage")) {
		return NextResponse.json({ error: "缺少 Docker 管理权限" }, { status: 403 });
	}

	const id = req.nextUrl.searchParams.get("id");
	const logs = req.nextUrl.searchParams.get("logs");
	const stats = req.nextUrl.searchParams.get("stats");
	const tailRaw = req.nextUrl.searchParams.get("tail") || "100";
	const tail = isValidTail(tailRaw) ? tailRaw : "100";

	// Validate container IDs to prevent path traversal
	if (id && !isValidDockerId(id)) {
		return NextResponse.json({ error: "无效的容器ID格式" }, { status: 400 });
	}
	if (logs && !isValidDockerId(logs)) {
		return NextResponse.json({ error: "无效的容器ID格式" }, { status: 400 });
	}
	if (stats && !isValidDockerId(stats)) {
		return NextResponse.json({ error: "无效的容器ID格式" }, { status: 400 });
	}

	try {
		if (stats) {
			const result = await dockerRequest(`/containers/${stats}/stats?stream=false`);
			if (!result.ok) return NextResponse.json(result);
			const detail = await dockerRequest(`/containers/${stats}/json`);
			const detailData = detail.data && typeof detail.data === "object" ? detail.data as { Name?: string } : {};
			const name = detailData.Name?.replace(/^\//, "") || stats.slice(0, 12);
			return NextResponse.json({ ok: true, status: result.status, data: parseDockerStats(stats, name, result.data as Record<string, unknown>) });
		}

		if (logs) {
			const result = await dockerRequest(`/containers/${logs}/logs?stdout=true&stderr=true&tail=${tail}`);
			return NextResponse.json(result);
		}

		if (id) {
			const result = await dockerRequest(`/containers/${id}/json`);
			return NextResponse.json(result);
		}

		const result = await dockerRequest("/containers/json?all=true");
		return NextResponse.json(result);
	} catch (error) {
		logger.error("GET请求失败", error);
		return NextResponse.json({ error: "Docker API 请求失败" }, { status: 500 });
	}
}

export async function POST(req: NextRequest) {
	const rl = withRateLimit(req, COMMAND_LIMIT);
	if (!rl.allowed) return rateLimitResponse(rl.retryAfterMs);
	const session = await requireApiSession();
	if (!isSessionPayload(session)) return session; // 401 response
	if (!sessionHasPermission(session, "docker:manage")) {
		return NextResponse.json({ error: "缺少 Docker 管理权限" }, { status: 403 });
	}

	try {
		const parsed = containerActionSchema.safeParse(await req.json());
		if (!parsed.success) return NextResponse.json({ error: "输入参数无效" }, { status: 400 });
		const { id, action } = parsed.data;

		// Validate container ID to prevent path traversal
		if (!isValidDockerId(id)) {
			return NextResponse.json({ error: "无效的容器ID格式" }, { status: 400 });
		}

		const actionMap: Record<string, { path: string; method: string }> = {
			start: { path: `/containers/${id}/start`, method: "POST" },
			stop: { path: `/containers/${id}/stop`, method: "POST" },
			restart: { path: `/containers/${id}/restart`, method: "POST" },
			remove: { path: `/containers/${id}?force=true`, method: "DELETE" },
		};

		const target = actionMap[action];

		const result = await dockerRequest(target.path, target.method);
		return NextResponse.json(result);
	} catch (error) {
		logger.error("POST请求失败", error);
		return NextResponse.json({ error: "Docker 操作失败" }, { status: 500 });
	}
}
