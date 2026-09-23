import http from "node:http";

import { createLogger } from "@/lib/logging";
import { execRemoteCommand, buildSshParamsFromServer } from "@/lib/ssh/client";
import { prisma } from "@/lib/db";
import { dockerEngineEndpoint, dockerEngineSocketPath } from "@/lib/runtime/platform-paths";

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

/** Hub-host scope (local Docker socket / named pipe, or DOCKER_HOST) */
export const hubHostDockerScope: DockerScope = {
	scope: "hub-host",
	get socketPath() { return dockerEngineSocketPath(); },
	warning:
		"The Docker module only operates on the VControlHub host's Docker socket; it is not a cross-VPS container console. Users with docker:manage permission can manage local containers.",
};

/** Build a remote-VPS scope descriptor */
export function remoteVpsDockerScope(serverId: string, serverName: string): DockerScope {
	return {
		scope: "remote-vps",
		socketPath: "/var/run/docker.sock",
		serverId,
		serverName,
		warning: `Managing Docker on remote VPS "${serverName}" via SSH. Container operations are executed on the remote host.`,
	};
}

/** Default timeouts: short for GETs, longer for lifecycle mutations. */
const DEFAULT_LOCAL_TIMEOUT_MS = 10_000;
const DEFAULT_REMOTE_TIMEOUT_MS = 30_000;
const DEFAULT_MUTATION_LOCAL_TIMEOUT_MS = 120_000;
const DEFAULT_MUTATION_REMOTE_TIMEOUT_MS = 120_000;

/**
 * Cap on a single local Engine API response. Mirrors (2x) the 16MB remote
 * execRemoteCommand output bound: without it a chatty endpoint (e.g. a huge
 * /containers/{id}/logs or events stream) buffers unbounded chunks into
 * memory before anyone parses them.
 */
const MAX_LOCAL_ENGINE_RESPONSE_BYTES = 32 * 1024 * 1024;

function isMutationMethod(method: string): boolean {
	return !["GET", "HEAD", "OPTIONS"].includes(method.toUpperCase());
}

/**
 * Request Docker Engine API via the local unix socket / named pipe
 * (original implementation; endpoint resolved per platform and DOCKER_HOST).
 */
export function requestDockerEngine(
	apiPath: string,
	options: {
		method?: string;
		body?: string;
		unavailableData: unknown;
		loggerScope: string;
		/** Override HTTP socket timeout (ms). Defaults: 10s GET, 120s mutations. */
		timeoutMs?: number;
	},
): Promise<DockerEngineResult> {
	const { method = "GET", body, unavailableData, loggerScope } = options;
	const timeoutMs =
		options.timeoutMs ??
		(isMutationMethod(method) ? DEFAULT_MUTATION_LOCAL_TIMEOUT_MS : DEFAULT_LOCAL_TIMEOUT_MS);
	const logger = createLogger(loggerScope);
	const endpoint = dockerEngineEndpoint();
	const requestOptions: http.RequestOptions = {
		path: apiPath,
		method,
		timeout: timeoutMs,
		headers: body ? { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) } : {},
	};
	if (endpoint.kind === "socket") {
		requestOptions.socketPath = endpoint.socketPath;
		requestOptions.host = "localhost";
	} else {
		requestOptions.host = endpoint.host;
		requestOptions.port = endpoint.port;
	}
	return new Promise((resolve) => {
		const request = http.request(requestOptions, (response) => {
			const chunks: Buffer[] = [];
			let received = 0;
			let oversized = false;
			response.on("data", (chunk: Buffer) => {
				if (oversized) return;
				received += chunk.length;
				if (received > MAX_LOCAL_ENGINE_RESPONSE_BYTES) {
					// Abort the transfer instead of buffering an unbounded stream;
					// the promise settles once here, later error events are ignored.
					oversized = true;
					chunks.length = 0;
					logger.error("Docker Engine response exceeded byte cap; aborting", undefined, {
						apiPath,
						method,
						limitBytes: MAX_LOCAL_ENGINE_RESPONSE_BYTES,
					});
					request.destroy();
					resolve({
						ok: false,
						status: 502,
						data: { message: `Docker Engine response exceeded ${MAX_LOCAL_ENGINE_RESPONSE_BYTES} bytes limit` },
					});
					return;
				}
				chunks.push(chunk);
			});
			response.on("end", () => {
				if (oversized) return;
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
		/** Override remote SSH/curl timeout (ms). Defaults: 30s GET, 120s mutations. */
		timeoutMs?: number;
	},
): Promise<DockerEngineResult> {
	const { method = "GET", body, unavailableData, loggerScope } = options;
	const timeoutMs =
		options.timeoutMs ??
		(isMutationMethod(method) ? DEFAULT_MUTATION_REMOTE_TIMEOUT_MS : DEFAULT_REMOTE_TIMEOUT_MS);
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
	// Use -s (silent), output body + HTTP status code separated by newline.
	// The URL MUST be single-quoted: validateDockerApiPath permits `&` (needed
	// for multi-param queries like logs?stdout=true&stderr=true&tail=N). Left
	// unquoted, the remote shell reads `&` as a background operator and silently
	// drops every param after the first (logs lose stderr + tail). The validator
	// forbids single quotes, so wrapping in '...' cannot break out or inject.
	const curlCmd = `curl --unix-socket /var/run/docker.sock -s -w '\\n%{http_code}'${methodFlag}${bodyFlag} 'http://localhost${apiPath}'`;

	logger.debug("Remote Docker request", { serverId, serverName: server.name, apiPath, method });

	try {
		const result = await execRemoteCommand({
			...sshParams,
			command: curlCmd,
			timeout: timeoutMs,
		});

		if (result.exitCode !== 0) {
			// curl still writes "\n000" when it cannot open the Unix socket, so
			// stdout presence is not evidence that Docker answered the request.
			const stderr = result.stderr.toLowerCase();
			const curlStatus = result.stdout.trim().split("\n").at(-1);
			if (curlStatus === "000" || stderr.includes("no such file") || stderr.includes("connection refused") || stderr.includes("permission denied") || stderr.includes("couldn't connect")) {
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
		/** Override request timeout (ms); see requestDockerEngine / requestRemoteDockerEngine defaults. */
		timeoutMs?: number;
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
