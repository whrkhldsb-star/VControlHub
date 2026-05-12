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

const DOCKER_SOCKET = "/var/run/docker.sock";
const DOCKER_API = "http://localhost";

async function dockerFetch(path: string, init?: RequestInit) {
	const base: RequestInit = {
		...init,
	headers: { ...init?.headers },
} as RequestInit;
(base as Record<string, unknown>).unixSocket = DOCKER_SOCKET;
	try {
		const res = await fetch(`${DOCKER_API}${path}`, base);
		return res;
	} catch {
		// Fallback: try curl if fetch doesn't support unix sockets
		return null;
	}
}

/** Use curl as fallback for Docker socket communication */
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
	const { execSync } = require("child_process");
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
	const id = req.nextUrl.searchParams.get("id");
	const logs = req.nextUrl.searchParams.get("logs");
	const tail = req.nextUrl.searchParams.get("tail") || "100";

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
	try {
		const { id, action } = await req.json() as { id: string; action: "start" | "stop" | "restart" | "remove" };

		if (!id || !action) {
			return NextResponse.json({ error: "缺少容器ID或操作" }, { status: 400 });
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
