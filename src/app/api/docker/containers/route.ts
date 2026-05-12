/**
 * Docker containers API — list, inspect, start/stop/restart, logs.
 * Uses Docker Engine API via unix socket /var/run/docker.sock
 * 
 * GET    /api/docker/containers          — list containers
 * GET    /api/docker/containers?id=xxx    — inspect one container
 * POST   /api/docker/containers           — start/stop/restart {id, action}
 * GET    /api/docker/containers?logs=xxx  — get container logs
 */
import { NextRequest, NextResponse } from "next/server";
import { execSync } from "child_process";
import { requireApiSession, isSessionPayload } from "@/lib/auth/api-session";

const DOCKER_SOCKET = "/var/run/docker.sock";
const DOCKER_API = "http://localhost";

/** Validate Docker container ID: only allow hex chars and names (alphanumeric + _.-) */
function isValidDockerId(value: string): boolean {
	return /^[a-zA-Z0-9_.-]+$/.test(value) && value.length <= 128;
}

/** Validate tail parameter: only allow positive integers */
function isValidTail(value: string): boolean {
	return /^\d{1,5}$/.test(value) && parseInt(value, 10) <= 50000;
}

/** Use curl for Docker socket communication (fetch doesn't support unix sockets) */
async function dockerCurl(path: string, method = "GET", body?: string): Promise<{ ok: boolean; status: number; data: unknown }> {
	const args = [
		"--silent", "--show-error",
		"-X", method,
		"--unix-socket", DOCKER_SOCKET,
		`${DOCKER_API}${path}`,
	];
	if (body) {
		args.push("-H", "Content-Type: application/json", "-d", body);
	}
	try {
		const out = execSync(`curl ${args.map(a => `"${a}"`).join(" ")}`, {
			timeout: 10000,
			encoding: "utf-8",
		});
		return { ok: true, status: 200, data: JSON.parse(out) };
	} catch (e: unknown) {
		const err = e as { stdout?: string; status?: number };
		const data = err.stdout ? (() => { try { return JSON.parse(err.stdout); } catch { return err.stdout; } })() : null;
		return { ok: false, status: err.status || 500, data };
	}
}

export async function GET(req: NextRequest) {
	const session = await requireApiSession();
	if (!isSessionPayload(session)) return session; // 401 response

	const id = req.nextUrl.searchParams.get("id");
	const logs = req.nextUrl.searchParams.get("logs");
	const tailRaw = req.nextUrl.searchParams.get("tail") || "100";
	const tail = isValidTail(tailRaw) ? tailRaw : "100";

	// Validate container IDs to prevent command injection
	if (id && !isValidDockerId(id)) {
		return NextResponse.json({ error: "无效的容器ID格式" }, { status: 400 });
	}
	if (logs && !isValidDockerId(logs)) {
		return NextResponse.json({ error: "无效的容器ID格式" }, { status: 400 });
	}

	try {
		if (logs) {
			const result = await dockerCurl(`/containers/${logs}/logs?stdout=true&stderr=true&tail=${tail}`);
			return NextResponse.json(result);
		}

		if (id) {
			const result = await dockerCurl(`/containers/${id}/json`);
			return NextResponse.json(result);
		}

		const result = await dockerCurl("/containers/json?all=true");
		return NextResponse.json(result);
	} catch (error) {
		console.error("[docker/containers GET]", error);
		return NextResponse.json({ error: "Docker API 请求失败" }, { status: 500 });
	}
}

export async function POST(req: NextRequest) {
	const session = await requireApiSession();
	if (!isSessionPayload(session)) return session; // 401 response

	try {
		const { id, action } = await req.json() as { id: string; action: "start" | "stop" | "restart" | "remove" };

		if (!id || !action) {
			return NextResponse.json({ error: "缺少容器ID或操作" }, { status: 400 });
		}

		// Validate container ID to prevent command injection
		if (!isValidDockerId(id)) {
			return NextResponse.json({ error: "无效的容器ID格式" }, { status: 400 });
		}

		const actionMap: Record<string, string> = {
			start: `/containers/${id}/start`,
			stop: `/containers/${id}/stop`,
			restart: `/containers/${id}/restart`,
			remove: `/containers/${id}?force=true`,
		};

		const method = action === "remove" ? "DELETE" : "POST";
		const path = actionMap[action];

		if (!path) {
			return NextResponse.json({ error: "无效操作" }, { status: 400 });
		}

		const result = await dockerCurl(path, method);
		return NextResponse.json(result);
	} catch (error) {
		console.error("[docker/containers POST]", error);
		return NextResponse.json({ error: "Docker 操作失败" }, { status: 500 });
	}
}
