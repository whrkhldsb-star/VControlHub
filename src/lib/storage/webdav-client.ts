import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { Agent, fetch as undiciFetch } from "undici";
import { XMLParser, XMLValidator } from "fast-xml-parser";
import { BusinessError, ValidationError } from "@/lib/errors";
import { validateWebhookUrlSyntax } from "@/lib/security/webhook-url";
import { isUnsafePublicHttpHost } from "./direct-access-url";
import { resolveStorageWebDavCredentials, type WebDavStorageNode } from "./webdav-credentials";

export type WebDavEntry = { name: string; relativePath: string; isDirectory: boolean; size: number; lastModifiedMs: number };
/** Trusted code injection for fixtures only; never derived from node config or request input. */
export type WebDavTransport = (url: URL, init: RequestInit) => Promise<Response>;
const READ_LIMIT = 32 * 1024 * 1024;
const XML_LIMIT = 4 * 1024 * 1024;
export class WebDavHttpError extends BusinessError {
  constructor(readonly status: number) {
    const reason = ({ 401: "authentication rejected", 403: "access denied", 404: "not found", 409: "parent missing or conflict", 412: "destination exists", 423: "resource locked", 429: "rate limited", 507: "insufficient storage" } as Record<number, string>)[status] ?? "request failed";
    super(`WebDAV HTTP ${status}: ${reason}`);
  }
}

/** Pin the verified address in the actual TLS connector, keep original host/SNI and certificate validation. */
const safeTransport: WebDavTransport = async (url, init) => {
  if (!validateWebhookUrlSyntax(url.href).ok || isUnsafePublicHttpHost(url.hostname)) throw new ValidationError("WebDAV endpoint is not public HTTPS");
  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  const addresses = isIP(hostname) ? [{ address: hostname, family: isIP(hostname) }] : await lookup(hostname, { all: true, verbatim: true });
  if (!addresses.length || addresses.some(({ address }) => {
    // Allow only global unicast IPv6 (also excludes NAT64/IPv4-compatible/transition ranges).
    return isUnsafePublicHttpHost(address) || !validateWebhookUrlSyntax(`https://${isIP(address) === 6 ? `[${address}]` : address}`).ok ||
      (isIP(address) === 6 && (!/^[23]/i.test(address) || /^200[12]:/i.test(address)));
  })) throw new ValidationError("WebDAV DNS resolved to a non-public address");
  const pinned = addresses[0]!;
  const dispatcher = new Agent({ connect: {
    rejectUnauthorized: true,
    timeout: 15_000,
    lookup(name, options, callback) {
      if (name !== hostname) { callback(new Error("Unverified WebDAV host"), undefined as never, undefined as never); return; }
      if (typeof options === "object" && options?.all) callback(null, [pinned], undefined as never);
      else callback(null, pinned.address, pinned.family);
    },
  } });
  const dispose = () => dispatcher.destroy().catch(() => undefined);
  try {
    const upstream = await undiciFetch(url, { ...init, redirect: "manual", dispatcher } as Parameters<typeof undiciFetch>[1]);
    if (!upstream.body) { await dispose(); return new Response(null, { status: upstream.status, headers: Object.fromEntries(upstream.headers) }); }
    const reader = upstream.body.getReader();
    const body = new ReadableStream<Uint8Array>({
      async pull(controller) {
        try { const next = await reader.read(); if (next.done) { controller.close(); await dispose(); } else controller.enqueue(next.value); }
        catch { controller.error(new BusinessError("WebDAV stream failed")); await dispose(); }
      },
      async cancel() { await reader.cancel().catch(() => undefined); await dispose(); },
    });
    return new Response(body, { status: upstream.status, headers: Object.fromEntries(upstream.headers) });
  } catch { await dispose(); throw new BusinessError("WebDAV connection or TLS verification failed"); }
};

function segments(path: string): string[] {
  if (typeof path !== "string" || /[\\\x00-\x1f\x7f]/.test(path) || /%(?:2e|2f|5c|25|00)/i.test(path)) throw new ValidationError("Invalid WebDAV path");
  const parts = path.split("/").filter(Boolean);
  if (parts.some((p) => p === "." || p === "..")) throw new ValidationError("WebDAV path exceeds root");
  return parts;
}
async function limited(response: Response, maxBytes: number): Promise<Buffer> {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 0) { await response.body?.cancel(); throw new ValidationError("Invalid WebDAV read limit"); }
  if (Number(response.headers.get("content-length")) > maxBytes) { await response.body?.cancel(); throw new BusinessError("WebDAV response too large"); }
  const reader = response.body?.getReader();
  if (!reader) return Buffer.alloc(0);
  const chunks: Uint8Array[] = []; let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read(); if (done) break;
      total += value.byteLength;
      if (total > maxBytes) throw new BusinessError("WebDAV response too large");
      chunks.push(value);
    }
    return Buffer.concat(chunks, total);
  } catch (error) { if (error instanceof BusinessError) throw error; throw new BusinessError("WebDAV response read failed"); }
  finally { await reader.cancel().catch(() => undefined); reader.releaseLock(); }
}
const array = (value: unknown): unknown[] => value === undefined ? [] : Array.isArray(value) ? value : [value];
const object = (value: unknown): Record<string, unknown> => value !== null && typeof value === "object" ? value as Record<string, unknown> : {};

export function createWebDavClient(node: WebDavStorageNode, dependencies: { transport?: WebDavTransport } = {}) {
  const config = resolveStorageWebDavCredentials(node);
  const endpoint = new URL(config.endpoint);
  const root = endpoint.pathname.replace(/\/+$/, "") + "/" + segments(node.basePath).map(encodeURIComponent).join("/");
  const rootPath = root.replace(/\/+$/, "");
  const transport = dependencies.transport ?? safeTransport;
  const authorization = config.authType === "basic" ? `Basic ${Buffer.from(`${config.username}:${config.password}`).toString("base64")}` : `Bearer ${config.token}`;
  const target = (path: string) => { const url = new URL(endpoint); url.pathname = rootPath + "/" + segments(path).map(encodeURIComponent).join("/"); return url; };
  async function request(method: string, path: string, headers: Record<string, string> = {}, body?: Buffer | string) {
    const url = target(path);
    let response: Response;
    try {
      response = await transport(url, { method, headers: { Authorization: authorization, ...headers }, ...(body !== undefined ? { body: body as BodyInit } : {}), redirect: "manual", signal: AbortSignal.timeout(120_000) });
    } catch { throw new BusinessError("WebDAV connection, DNS policy or TLS verification failed"); }
    if (!response.ok) { await response.body?.cancel().catch(() => undefined); throw new WebDavHttpError(response.status); }
    return response;
  }
  async function propfind(path: string, depth: "0" | "1"): Promise<WebDavEntry[]> {
    const response = await request("PROPFIND", path, { Depth: depth, "Content-Type": "application/xml; charset=utf-8" }, '<?xml version="1.0"?><d:propfind xmlns:d="DAV:"><d:prop><d:resourcetype/><d:getcontentlength/><d:getlastmodified/></d:prop></d:propfind>');
    const xml = (await limited(response, XML_LIMIT)).toString("utf8");
    if (/<!DOCTYPE|<!ENTITY/i.test(xml) || XMLValidator.validate(xml) !== true) throw new BusinessError("Invalid WebDAV XML response");
    const parsed = object(new XMLParser({ removeNSPrefix: true, parseTagValue: false, processEntities: true }).parse(xml));
    if (!parsed.multistatus) throw new BusinessError("Invalid WebDAV multistatus response");
    const rows = array(object(parsed.multistatus).response);
    if (rows.length > 5000) throw new BusinessError("WebDAV directory too large");
    const entries: WebDavEntry[] = [];
    for (const raw of rows) {
      const row = object(raw);
      const href = row.href;
      if (typeof href !== "string") throw new BusinessError("Invalid WebDAV response path");
      let decoded: string;
      try {
        const url = new URL(href, target(path));
        if (url.origin !== endpoint.origin || url.username || url.password || url.hash || url.search) throw new Error();
        decoded = decodeURIComponent(url.pathname).replace(/\/+$/, "");
        const decodedRoot = decodeURIComponent(rootPath);
        if (decoded !== decodedRoot && !decoded.startsWith(decodedRoot + "/")) throw new Error();
        decoded = segments(decoded.slice(decodedRoot.length)).join("/");
      } catch { throw new BusinessError("WebDAV response path exceeds root"); }
      const requested = segments(path).join("/");
      if (decoded !== requested && !(depth === "1" && decoded.startsWith(requested ? requested + "/" : "") && !decoded.slice(requested ? requested.length + 1 : 0).includes("/"))) throw new BusinessError("WebDAV response path exceeds requested directory");
      const props: Record<string, unknown> = {};
      for (const item of array(row.propstat)) {
        const block = object(item);
        if (/^HTTP\/\S+ 2\d\d(?:\s|$)/.test(String(block.status))) Object.assign(props, object(block.prop));
      }
      if (!Object.keys(props).length) {
        const status = Number(String(row.status ?? object(array(row.propstat)[0]).status).match(/\s(\d{3})(?:\s|$)/)?.[1]);
        throw new WebDavHttpError(Number.isInteger(status) && status >= 400 ? status : 502);
      }
      const size = Number(props.getcontentlength ?? 0);
      if (!Number.isSafeInteger(size) || size < 0) throw new BusinessError("Invalid WebDAV file size");
      entries.push({ relativePath: decoded, name: decoded.split("/").at(-1) ?? "", isDirectory: Object.hasOwn(object(props.resourcetype), "collection"), size, lastModifiedMs: Date.parse(String(props.getlastmodified)) || 0 });
    }
    return entries;
  }
  async function mutate(method: string, path: string, headers?: Record<string, string>, body?: Buffer | string) {
    if (!segments(path).length) throw new ValidationError("Cannot mutate WebDAV root path");
    const response = await request(method, path, headers, body);
    // DELETE/MOVE may report partial failure as 207: never claim success for it.
    await response.body?.cancel().catch(() => undefined);
    if (response.status === 207) throw new BusinessError("WebDAV operation returned partial multistatus; completion not confirmed");
  }
  return {
    async list(path = ""): Promise<WebDavEntry[]> { const key = segments(path).join("/"); return (await propfind(path, "1")).filter((e) => e.relativePath !== key); },
    async stat(path: string): Promise<WebDavEntry | null> { try { const entries = await propfind(path, "0"); if (!entries[0]) throw new BusinessError("Empty WebDAV stat response"); return entries[0]; } catch (e) { if (e instanceof WebDavHttpError && e.status === 404) return null; throw e; } },
    async read(path: string, maxBytes = READ_LIMIT): Promise<Buffer> { return limited(await request("GET", path), maxBytes); },
    async stream(path: string): Promise<ReadableStream<Uint8Array>> { const response = await request("GET", path); return response.body ?? new ReadableStream({ start(c) { c.close(); } }); },
    async write(path: string, content: string | Buffer): Promise<{ byteSize: number }> { const body = Buffer.isBuffer(content) ? content : Buffer.from(content); await mutate("PUT", path, { "Content-Type": "application/octet-stream" }, body); return { byteSize: body.length }; },
    async mkdir(path: string): Promise<void> { await mutate("MKCOL", path); },
    async delete(path: string): Promise<void> { await mutate("DELETE", path); },
    async rename(oldPath: string, newPath: string): Promise<void> { if (!segments(newPath).length) throw new ValidationError("Cannot replace WebDAV root path"); await mutate("MOVE", oldPath, { Destination: target(newPath).href.replace(/\/$/, ""), Overwrite: "F" }); },
  };
}
export type WebDavClient = ReturnType<typeof createWebDavClient>;
