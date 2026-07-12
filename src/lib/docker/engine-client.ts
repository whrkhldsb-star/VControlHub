import http from "node:http";

import { createLogger } from "@/lib/logging";

const DOCKER_SOCKET = "/var/run/docker.sock";
const UNAVAILABLE_CODES = new Set(["ENOENT", "ECONNREFUSED", "EACCES"]);

export type DockerEngineResult = {
	ok: boolean;
	status: number;
	data: unknown;
	dockerAvailable?: boolean;
	message?: string;
};

export function requestDockerEngine(
	apiPath: string,
	options: {
		method?: string;
		body?: string;
		unavailableData: unknown;
		loggerScope: string;
	},
): Promise<DockerEngineResult> {
	const { method = "GET", body, unavailableData, loggerScope } = options;
	const logger = createLogger(loggerScope);
	return new Promise((resolve) => {
		const request = http.request({
			socketPath: DOCKER_SOCKET,
			path: apiPath,
			method,
			host: "localhost",
			timeout: 10_000,
			headers: body ? { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) } : {},
		}, (response) => {
			const chunks: Buffer[] = [];
			response.on("data", (chunk: Buffer) => chunks.push(chunk));
			response.on("end", () => {
				const raw = Buffer.concat(chunks).toString("utf-8");
				let data: unknown = raw || null;
				try { data = raw ? JSON.parse(raw) : null; } catch { /* preserve raw daemon response */ }
				const status = response.statusCode ?? 500;
				resolve({ ok: status >= 200 && status < 300, status, data });
			});
		});
		request.on("error", (error) => {
			if (UNAVAILABLE_CODES.has((error as NodeJS.ErrnoException).code ?? "")) {
				logger.warn("Docker socket unavailable", error, { apiPath, method });
				resolve({ ok: true, status: 200, data: unavailableData, dockerAvailable: false, message: "Docker is not installed or Docker socket is unavailable" });
				return;
			}
			logger.error("Docker socket request failed", error, { apiPath, method });
			resolve({ ok: false, status: 502, data: { message: "Docker daemon unreachable" } });
		});
		request.on("timeout", () => {
			request.destroy();
			resolve({ ok: false, status: 504, data: { message: "Docker API timeout" } });
		});
		if (body) request.write(body);
		request.end();
	});
}
