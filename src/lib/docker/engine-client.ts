import http from "node:http";

import { createLogger } from "@/lib/logging";
import { execRemoteCommand, buildSshParamsFromServer } from "@/lib/ssh/client";
import { prisma } from "@/lib/db";

const DOCKER_SOCKET = "/var/run/docker.sock";
const UNAVAILABLE_CODES = new Set(["ENOENT", "ECONNREFUSED", "EACCES"]);

export type DockerEngineResult = {
	ok: boolean;
	status: number;
	data: unknown;
	dockerAvailable?: boolean;
	message?: string;
};

export type DockerScope = {
	scope: "hub-host" | "remote-vps";
	socketPath: string;
	serverId?: string;
	serverName?: string;
	warning: string;
};

/** Hub-host scope (local Docker socket) */
export const hubHostDockerScope: DockerScope = {
	scope: "hub-host",
	socketPath: DOCKER_SOCKET,
	warning:
		"The Docker module only operates on the VControlHub host's Docker socket; it is not a cross-VPS container console. Users with docker:manage permission can manage local containers.",
};

/** Build a remote-VPS scope descriptor */
export function remoteVpsDockerScope(serverId: string, serverName: string): DockerScope {
	return {
		scope: "remote-vps",
		socketPath: DOCKER_SOCKET,
		serverId,
		serverName,
		warning: `Managing Docker on remote VPS "${serverName}" via SSH. Container operations are executed on the remote host.`,
	};
}

/**
 * Request Docker Engine API via local unix socket (original implementation).
 */
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

/**
 * Validate a Docker Engine API path to prevent shell injection.
 * Only allows: /containers/json, /containers/{id}/json, /containers/{id}/start, etc.
 */
export function validateDockerApiPath(apiPath: string): boolean {
	// Allow only alphanumeric, /, ?, =, &, ., _, -, and spaces (for query params like "all=true")
	return /^\/[a-zA-Z0-9\/?=&_.-]+$/.test(apiPath) && !apiPath.includes("..");
}

/**
 * FEAT-P0-2: Request Docker Engine API on a remote VPS via SSH.
 *
 * Executes `curl --unix-socket /var/run/docker.sock http://localhost{apiPath}`
 * on the remote server. This avoids opening a TCP port and reuses existing
 * SSH key infrastructure.
 *
 * The curl command is constructed with validated, injection-safe paths only.
 */
export async function requestRemoteDockerEngine(
	serverId: string,
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

	// Validate API path to prevent injection
	if (!validateDockerApiPath(apiPath)) {
		logger.error("Invalid Docker API path rejected", undefined, { apiPath });
		return { ok: false, status: 400, data: { message: "Invalid Docker API path" } };
	}

	// Validate HTTP method (whitelist to prevent injection)
	const ALLOWED_METHODS = new Set(["GET", "POST", "PUT", "DELETE", "PATCH", "HEAD"]);
	if (!ALLOWED_METHODS.has(method.toUpperCase())) {
		logger.error("Invalid HTTP method rejected", undefined, { method });
		return { ok: false, status: 400, data: { message: "Invalid HTTP method" } };
	}

	// Fetch server + SSH key from DB
	const server = await prisma.server.findUnique({
		where: { id: serverId },
		select: {
			id: true,
			name: true,
			host: true,
			port: true,
			username: true,
			password: true,
			sshKeyId: true,
			hostKeySha256: true,
			enabled: true,
			sshKey: { select: { privateKey: true, passphrase: true } },
		},
	});

	if (!server) {
		return { ok: false, status: 404, data: { message: "Server not found" } };
	}
	if (!server.enabled) {
		return { ok: false, status: 403, data: { message: "Server is disabled" } };
	}

	const sshParams = await buildSshParamsFromServer(server, server.sshKey);

	// Build curl command. Use -s (silent), -w to get HTTP status, output body to stdout.
	// For methods other than GET, add -X method. For body, pipe via heredoc-free approach.
	// curl --unix-socket /var/run/docker.sock -s -w '\n%{http_code}' [-X METHOD] [-d @-] http://localhost{apiPath}
	const methodFlag = method !== "GET" ? ` -X ${method}` : "";
	const bodyFlag = body ? ` -d '${body.replace(/'/g, "'\\''")}'` : "";
	// Use -s (silent), output body + HTTP status code separated by newline
	const curlCmd = `curl --unix-socket /var/run/docker.sock -s -w '\\n%{http_code}'${methodFlag}${bodyFlag} http://localhost${apiPath}`;

	logger.debug("Remote Docker request", { serverId, serverName: server.name, apiPath, method });

	try {
		const result = await execRemoteCommand({
			...sshParams,
			command: curlCmd,
			timeout: 30_000,
		});

		if (result.exitCode !== 0 && !result.stdout) {
			// curl failed entirely — Docker probably not installed
			const stderr = result.stderr.toLowerCase();
			if (stderr.includes("no such file") || stderr.includes("connection refused") || stderr.includes("permission denied")) {
				return { ok: true, status: 200, data: unavailableData, dockerAvailable: false, message: "Docker is not installed or Docker socket is unavailable on the remote server" };
			}
			logger.error("Remote Docker SSH command failed", undefined, { serverId, stderr: result.stderr, exitCode: result.exitCode });
			return { ok: false, status: 502, data: { message: `Remote Docker request failed: ${result.stderr || "SSH error"}` } };
		}

		// Parse curl output: body + "\n" + http_status
		const output = result.stdout;
		const lastNewline = output.lastIndexOf("\n");
		if (lastNewline === -1) {
			// No status code in output — treat as error
			return { ok: false, status: 502, data: { message: "Malformed Docker response from remote server" } };
		}

		const httpStatus = parseInt(output.slice(lastNewline + 1).trim(), 10);
		const responseBody = output.slice(0, lastNewline);

		let data: unknown = responseBody || null;
		try {
			data = responseBody ? JSON.parse(responseBody) : null;
		} catch {
			// preserve raw response
		}

		const ok = httpStatus >= 200 && httpStatus < 300;
		return { ok, status: httpStatus, data };
	} catch (err) {
		const message = err instanceof Error ? err.message : "SSH connection failed";
		logger.error("Remote Docker SSH error", err, { serverId });
		return { ok: false, status: 502, data: { message: `SSH connection to server failed: ${message}` } };
	}
}

/**
 * Unified Docker request: routes to local socket or remote VPS based on serverId.
 */
export async function dockerRequest(
	apiPath: string,
	options: {
		method?: string;
		body?: string;
		unavailableData: unknown;
		loggerScope: string;
		serverId?: string;
	},
): Promise<{ result: DockerEngineResult; scope: DockerScope }> {
	const { serverId, ...rest } = options;

	if (serverId) {
		// Remote VPS Docker
		const server = await prisma.server.findUnique({
			where: { id: serverId },
			select: { name: true },
		});
		const scope = remoteVpsDockerScope(serverId, server?.name ?? serverId);
		const result = await requestRemoteDockerEngine(serverId, apiPath, rest);
		return { result, scope };
	}

	// Local hub-host Docker
	const result = await requestDockerEngine(apiPath, rest);
	return { result, scope: hubHostDockerScope };
}
