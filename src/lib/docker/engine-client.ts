import http from "node:http";

import { createLogger } from "@/lib/logging";
import { execRemoteCommand, buildSshParamsFromServer } from "@/lib/ssh/client";
import { prisma } from "@/lib/db";
import { dockerEngineEndpoint, dockerEngineSocketPath } from "@/lib/runtime/platform-paths";
import { SSH_CONNECTION_SERVER_SELECT } from "@/lib/ssh/server-connection-select";

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
		"This scope is the Docker socket of the machine running VControlHub; choose a server as the Docker target to manage its containers. Users with docker:manage can administer every container on this host.",
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

/**
 * Container logs as text. A container without a TTY answers in Docker's
 * multiplexed format: each chunk carries an 8-byte header (stream, 0, 0, 0,
 * big-endian length). Shown as is, every line began with stray characters.
 * A TTY container's raw stream, or anything not framed, is returned as text.
 */
export function demuxDockerLogs(raw: Buffer): string {
	const parts: Buffer[] = [];
	let offset = 0;
	while (offset + 8 <= raw.length) {
		const stream = raw[offset]!;
		if (stream > 2 || raw[offset + 1] !== 0 || raw[offset + 2] !== 0 || raw[offset + 3] !== 0) {
			return raw.toString("utf-8");
		}
		const end = Math.min(raw.length, offset + 8 + raw.readUInt32BE(offset + 4));
		parts.push(raw.subarray(offset + 8, end));
		offset = end;
	}
	if (offset < raw.length) {
		if (parts.length === 0) return raw.toString("utf-8");
		parts.push(raw.subarray(offset));
	}
	return Buffer.concat(parts).toString("utf-8");
}

/** How a successful body is read: JSON (the default) or container log text. */
type DockerResponseDecoding = "json" | "docker-logs";

function decodeDockerBody(raw: Buffer, ok: boolean, decode: DockerResponseDecoding | undefined): unknown {
	if (ok && decode === "docker-logs") return demuxDockerLogs(raw);
	const text = raw.toString("utf-8");
	try { return text ? JSON.parse(text) : null; } catch { return text || null; }
}

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
		decode?: DockerResponseDecoding;
	},
): Promise<DockerEngineResult> {
	const { method = "GET", body, unavailableData, loggerScope, decode } = options;
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
			// A connection that drops after the headers never emits "end", and
			// the idle timeout belongs to the request (already answered): the
			// caller waited forever. Settle as a failed read instead.
			response.on("aborted", () => {
				if (oversized) return;
				resolve({ ok: false, status: 502, data: { message: "Docker Engine response ended early" } });
			});
			response.on("error", () => {
				if (oversized) return;
				resolve({ ok: false, status: 502, data: { message: "Docker Engine response ended early" } });
			});
			response.on("close", () => {
				if (oversized || response.complete) return;
				resolve({ ok: false, status: 502, data: { message: "Docker Engine response ended early" } });
			});
			response.on("end", () => {
				if (oversized) return;
				const status = response.statusCode ?? 500;
				const ok = status >= 200 && status < 300;
				resolve({ ok, status, data: decodeDockerBody(Buffer.concat(chunks), ok, decode) });
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
		decode?: DockerResponseDecoding;
	},
): Promise<DockerEngineResult> {
	const { method = "GET", body, unavailableData, loggerScope, decode } = options;
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
			...SSH_CONNECTION_SERVER_SELECT,
			name: true,
			enabled: true,
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
	// Docker refuses a JSON body sent as curl -d's default form encoding
	// ("unsupported Content-Type header"): creating a volume or network on a
	// remote server always failed.
	const bodyFlag = body ? ` -H 'Content-Type: application/json' -d '${body.replace(/'/g, "'\\''")}'` : "";
	// Use -s (silent), output body + HTTP status code separated by newline.
	// The URL MUST be single-quoted: validateDockerApiPath permits `&` (needed
	// for multi-param queries like logs?stdout=true&stderr=true&tail=N). Left
	// unquoted, the remote shell reads `&` as a background operator and silently
	// drops every param after the first (logs lose stderr + tail). The validator
	// forbids single quotes, so wrapping in '...' cannot break out or inject.
	const curlCmd = decode === "docker-logs"
		// Logs are binary frames, which SSH output (decoded as UTF-8) would
		// mangle: fetch them to a file and return them base64-encoded.
		? `f=$(mktemp) || exit 1; code=$(curl --unix-socket /var/run/docker.sock -s -o "$f" -w '%{http_code}'${methodFlag} 'http://localhost${apiPath}'); rc=$?; base64 < "$f" | tr -d '\\n'; rm -f -- "$f"; printf '\\n%s' "$code"; exit $rc`
		: `curl --unix-socket /var/run/docker.sock -s -w '\\n%{http_code}'${methodFlag}${bodyFlag} 'http://localhost${apiPath}'`;

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
		const ok = httpStatus >= 200 && httpStatus < 300;
		const raw = decode === "docker-logs" ? Buffer.from(responseBody.trim(), "base64") : Buffer.from(responseBody, "utf-8");
		return { ok, status: httpStatus, data: decodeDockerBody(raw, ok, decode) };
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
		decode?: DockerResponseDecoding;
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
