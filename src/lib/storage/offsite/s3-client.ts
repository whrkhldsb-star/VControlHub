/**
 * TR-007 M03: 异地备份 S3 兼容客户端。
 *
 * 目标: 不引入新依赖, 用 Node 22 内置 crypto + globalThis.fetch (undici) 实现
 * AWS Signature V4 签名, 覆盖 PUT / HEAD / DELETE / LIST (list-type=2) 四种
 * 异地备份所需的最少子集操作。
 *
 * 适用 provider: AWS S3 / Cloudflare R2 / Backblaze B2 / MinIO 等
 * S3-compatible 端点; 任意带 `endpoint` override 的实现都通过本客户端走。
 *
 * 不做的事 (留 P2):
 *   - 分片 / 断点续传 (整文件 PUT)
 *   - 服务端加密 (SSE-S3/SSE-KMS), 仅在请求头加 `x-amz-server-side-encryption: AES256`
 *   - 大文件流式签名 (putObject 接受 Buffer 或 string; 调用方负责把流读完)
 *   - 跨 region 重试
 */
import { createHmac, createHash, randomBytes } from "node:crypto";

/* ── Public types ────────────────────────────────────────── */

export type S3ClientConfig = {
	endpoint: string;
	region: string;
	bucket: string;
	accessKeyId: string;
	secretAccessKey: string;
	/** Force path-style addressing (MinIO / B2). Defaults to true unless endpoint is AWS. */
	pathStyle?: boolean;
	/** Optional override for fetch (used by tests). */
	fetchImpl?: typeof fetch;
	/** Request timeout in ms; default 30s. */
	timeoutMs?: number;
};

export type S3Object = {
	key: string;
	size: number;
	lastModified: string;
	etag: string;
};

export type S3ListResult = {
	objects: S3Object[];
	isTruncated: boolean;
	nextContinuationToken?: string;
};

export class S3Error extends Error {
	constructor(
		message: string,
		readonly status: number,
		readonly code: string,
		readonly requestId?: string,
	) {
		super(message);
		this.name = "S3Error";
	}
}

/* ── URL helpers ─────────────────────────────────────────── */

function normalizeEndpoint(endpoint: string): string {
	const trimmed = endpoint.trim().replace(/\/+$/, "");
	if (!trimmed) throw new S3Error("endpoint is required", 0, "InvalidEndpoint");
	return trimmed;
}

function isAwsS3(endpoint: string): boolean {
	return /(^|\.)amazonaws\.com$/i.test(new URL(endpoint.startsWith("http") ? endpoint : `https://${endpoint}`).hostname);
}

function buildBaseUrl(cfg: S3ClientConfig, key = ""): string {
	const endpoint = normalizeEndpoint(cfg.endpoint);
	const usePathStyle = cfg.pathStyle ?? !isAwsS3(endpoint);
	const keyPart = key ? `/${encodeURI(key).replace(/\+/g, "%2B")}` : "";
	if (usePathStyle) {
		return `${endpoint}/${cfg.bucket}${keyPart}`;
	}
	// Virtual-hosted style (AWS default): bucket.endpoint/key
	const parsed = new URL(endpoint);
	return `${parsed.protocol}//${cfg.bucket}.${parsed.host}${parsed.pathname.replace(/\/+$/, "")}${keyPart}`;
}

/* ── Signature V4 ────────────────────────────────────────── */

function sha256Hex(data: Buffer | string): string {
	return createHash("sha256").update(data).digest("hex");
}

function hmacSha256(key: Buffer | string, data: string): Buffer {
	return createHmac("sha256", key).update(data).digest();
}

function getAmzDate(now: Date): { dateStamp: string; amzDate: string } {
	const pad = (n: number) => String(n).padStart(2, "0");
	const dateStamp = `${now.getUTCFullYear()}${pad(now.getUTCMonth() + 1)}${pad(now.getUTCDate())}`;
	const amzDate = `${dateStamp}T${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}${pad(now.getUTCSeconds())}Z`;
	return { dateStamp, amzDate };
}

function getSigningKey(secret: string, dateStamp: string, region: string, service: string): Buffer {
	const kDate = hmacSha256(`AWS4${secret}`, dateStamp);
	const kRegion = hmacSha256(kDate, region);
	const kService = hmacSha256(kRegion, service);
	return hmacSha256(kService, "aws4_request");
}

type SignableRequest = {
	method: string;
	url: URL;
	headers: Record<string, string>;
	bodyHash: string;
	now: Date;
	region: string;
	accessKeyId: string;
};

function signV4(req: SignableRequest, secretAccessKey: string): { headers: Record<string, string>; authorization: string } {
	const { dateStamp, amzDate } = getAmzDate(req.now);
	const host = req.url.host;
	// Required headers in canonical request (host + x-amz-date + content-sha256, plus any custom amz headers)
	const signedHeaderKeys = ["host", "x-amz-content-sha256", "x-amz-date"];
	const customAmzHeaders: Array<[string, string]> = [];
	for (const [name, value] of Object.entries(req.headers)) {
		const lower = name.toLowerCase();
		if (lower.startsWith("x-amz-") && !signedHeaderKeys.includes(lower)) {
			signedHeaderKeys.push(lower);
			customAmzHeaders.push([name, value]);
		}
	}
	signedHeaderKeys.sort();
	const canonicalHeaders =
		signedHeaderKeys.map((k) => {
			if (k === "host") return `host:${host}\n`;
			if (k === "x-amz-content-sha256") return `x-amz-content-sha256:${req.bodyHash}\n`;
			if (k === "x-amz-date") return `x-amz-date:${amzDate}\n`;
			const found = customAmzHeaders.find(([n]) => n.toLowerCase() === k);
			const originalName = found ? found[0] : k;
			return `${k}:${req.headers[originalName]?.trim() ?? ""}\n`;
		}).join("");
	const canonicalRequest = [
		req.method,
		encodeURI(req.url.pathname).replace(/%2F/g, "/"),
		// Canonical query string: sort by name, then value
		Array.from(req.url.searchParams.entries())
			.sort(([a], [b]) => a.localeCompare(b))
			.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v).replace(/[!*'()]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)
				.replace(/%2F/g, "%2F")}`)
			.join("&"),
		canonicalHeaders,
		signedHeaderKeys.join(";"),
		req.bodyHash,
	].join("\n");
	const credentialScope = `${dateStamp}/${req.region}/s3/aws4_request`;
	const stringToSign = [
		"AWS4-HMAC-SHA256",
		amzDate,
		credentialScope,
		sha256Hex(canonicalRequest),
	].join("\n");
	const signingKey = getSigningKey(secretAccessKey, dateStamp, req.region, "s3");
	const signature = createHmac("sha256", signingKey).update(stringToSign).digest("hex");
	const authorization = `AWS4-HMAC-SHA256 Credential=${req.accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaderKeys.join(";")}, Signature=${signature}`;
	return {
		headers: {
			...req.headers,
			"x-amz-content-sha256": req.bodyHash,
			"x-amz-date": amzDate,
			authorization,
		},
		authorization,
	};
}

/* ── Client ──────────────────────────────────────────────── */

export class S3Client {
	private readonly cfg: S3ClientConfig;
	private readonly fetchImpl: typeof fetch;
	private readonly timeoutMs: number;

	constructor(config: S3ClientConfig) {
		if (!config.accessKeyId) throw new S3Error("accessKeyId is required", 0, "InvalidAccessKeyId");
		if (!config.secretAccessKey) throw new S3Error("secretAccessKey is required", 0, "InvalidSecretAccessKey");
		if (!config.bucket) throw new S3Error("bucket is required", 0, "InvalidBucket");
		if (!config.region) throw new S3Error("region is required", 0, "InvalidRegion");
		this.cfg = {
			...config,
			endpoint: normalizeEndpoint(config.endpoint),
		};
		this.fetchImpl = config.fetchImpl ?? globalThis.fetch.bind(globalThis);
		this.timeoutMs = config.timeoutMs ?? 30_000;
	}

	/** PUT an object (Buffer or string). */
	async putObject(key: string, body: Buffer | string, contentType?: string): Promise<{ etag: string; versionId?: string }> {
		const buf = typeof body === "string" ? Buffer.from(body, "utf8") : body;
		const url = this.buildUrl(key, new URLSearchParams());
		const headers: Record<string, string> = {
			"content-length": String(buf.length),
			"content-type": contentType ?? "application/octet-stream",
			"x-amz-server-side-encryption": "AES256",
		};
		const signed = this.sign("PUT", url, headers, buf);
		const res = await this.fetchImpl(url.toString(), {
			method: "PUT",
			headers: signed.headers,
			body: new Uint8Array(buf),
			signal: AbortSignal.timeout(this.timeoutMs),
		});
		await this.assertOk(res, "PUT", key);
		const etag = res.headers.get("etag") ?? "";
		return { etag: etag.replace(/"/g, "") };
	}

	/** HEAD an object; returns metadata or null if not found. */
	async headObject(key: string): Promise<{ size: number; etag: string; contentType: string; lastModified: string } | null> {
		const url = this.buildUrl(key, new URLSearchParams());
		const headers: Record<string, string> = {};
		const signed = this.sign("HEAD", url, headers, Buffer.alloc(0));
		const res = await this.fetchImpl(url.toString(), {
			method: "HEAD",
			headers: signed.headers,
			signal: AbortSignal.timeout(this.timeoutMs),
		});
		if (res.status === 404) return null;
		await this.assertOk(res, "HEAD", key);
		return {
			size: Number(res.headers.get("content-length") ?? 0),
			etag: (res.headers.get("etag") ?? "").replace(/"/g, ""),
			contentType: res.headers.get("content-type") ?? "application/octet-stream",
			lastModified: res.headers.get("last-modified") ?? "",
		};
	}

	/** DELETE an object. Idempotent (404 is treated as success). */
	async deleteObject(key: string): Promise<void> {
		const url = this.buildUrl(key, new URLSearchParams());
		const headers: Record<string, string> = {};
		const signed = this.sign("DELETE", url, headers, Buffer.alloc(0));
		const res = await this.fetchImpl(url.toString(), {
			method: "DELETE",
			headers: signed.headers,
			signal: AbortSignal.timeout(this.timeoutMs),
		});
		if (res.status === 404) return;
		await this.assertOk(res, "DELETE", key);
	}

	/** LIST objects v2 under an optional prefix. */
	async listObjects(prefix = "", maxKeys = 1000, continuationToken?: string): Promise<S3ListResult> {
		const params = new URLSearchParams();
		params.set("list-type", "2");
		if (prefix) params.set("prefix", prefix);
		params.set("max-keys", String(Math.min(Math.max(1, maxKeys), 1000)));
		if (continuationToken) params.set("continuation-token", continuationToken);
		const url = this.buildUrl("", params);
		const headers: Record<string, string> = {};
		const signed = this.sign("GET", url, headers, Buffer.alloc(0));
		const res = await this.fetchImpl(url.toString(), {
			method: "GET",
			headers: signed.headers,
			signal: AbortSignal.timeout(this.timeoutMs),
		});
		await this.assertOk(res, "LIST", prefix);
		const xml = await res.text();
		return parseListV2(xml);
	}

	/* ── Internals ──────────────────────────────────────── */

	private buildUrl(key: string, params: URLSearchParams): URL {
		const base = buildBaseUrl(this.cfg, key);
		const url = new URL(base);
		if (Array.from(params.entries()).length > 0) {
			for (const [k, v] of params.entries()) {
				url.searchParams.set(k, v);
			}
		}
		return url;
	}

	private sign(method: string, url: URL, headers: Record<string, string>, body: Buffer): { headers: Record<string, string> } {
		const bodyHash = method === "GET" || method === "HEAD" || method === "DELETE"
			? sha256Hex("")
			: sha256Hex(body);
		// Ensure Host header is present for canonical request
		const merged: Record<string, string> = { ...headers, host: url.host };
		return signV4(
			{
				method,
				url,
				headers: merged,
				bodyHash,
				now: new Date(),
				region: this.cfg.region,
				accessKeyId: this.cfg.accessKeyId,
			},
			this.cfg.secretAccessKey,
		);
	}

	private async assertOk(res: Response, op: string, key: string): Promise<void> {
		if (res.ok) return;
		const text = await res.text();
		const requestId = res.headers.get("x-amz-request-id") ?? undefined;
		const codeMatch = /<Code>([^<]+)<\/Code>/.exec(text);
		const msgMatch = /<Message>([^<]+)<\/Message>/.exec(text);
		const code = codeMatch?.[1] ?? "UnknownError";
		const message = msgMatch?.[1] ?? (text.slice(0, 200) || `${op} ${key} failed with status ${res.status}`);
		throw new S3Error(`${op} ${key} failed: ${message}`, res.status, code, requestId);
	}
}

/* ── Lightweight XML parser (list-type=2 only) ────────────── */

function parseListV2(xml: string): S3ListResult {
	const tag = (name: string): string => {
		const re = new RegExp(`<${name}>([\\s\\S]*?)</${name}>`);
		return re.exec(xml)?.[1]?.trim() ?? "";
	};
	const isTruncated = tag("IsTruncated") === "true";
	const nextContinuationToken = tag("NextContinuationToken") || undefined;
	const objects: S3Object[] = [];
	const contentsRe = /<Contents>([\s\S]*?)<\/Contents>/g;
	let m: RegExpExecArray | null;
	while ((m = contentsRe.exec(xml)) !== null) {
		const block = m[1] ?? "";
		const key = /<Key>([\s\S]*?)<\/Key>/.exec(block)?.[1] ?? "";
		const size = Number(/<Size>([\s\S]*?)<\/Size>/.exec(block)?.[1] ?? 0);
		const lastModified = /<LastModified>([\s\S]*?)<\/LastModified>/.exec(block)?.[1] ?? "";
		const etag = /<ETag>([\s\S]*?)<\/ETag>/.exec(block)?.[1] ?? "";
		if (key) objects.push({ key, size, lastModified, etag: etag.replace(/"/g, "") });
	}
	return { objects, isTruncated, nextContinuationToken };
}

/* ── Random helper for dry-run probe key ─────────────────── */

export function randomProbeKey(prefix = "_probe/"): string {
	return `${prefix}${randomBytes(8).toString("hex")}.probe`;
}
