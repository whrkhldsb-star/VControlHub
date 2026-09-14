import { apiCopy } from "@/lib/i18n/api-copy";
import { t } from "@/lib/i18n/service-translations";
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
  if (!validateWebhookUrlSyntax(url.href).ok || isUnsafePublicHttpHost(url.hostname)) throw new ValidationError(apiCopy("apiCopy.webdav.endpoint.is.not.public.https.b906f9ab"));
  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  const addresses = isIP(hostname) ? [{ address: hostname, family: isIP(hostname) }] : await lookup(hostname, { all: true, verbatim: true });
  if (!addresses.length || addresses.some(({ address }) => {
    // Allow only global unicast IPv6 (also excludes NAT64/IPv4-compatible/transition ranges).
    return isUnsafePublicHttpHost(address) || !validateWebhookUrlSyntax(`https://${isIP(address) === 6 ? `[${address}]` : address}`).ok ||
      (isIP(address) === 6 && (() => {
        // Canonicalize expanded spellings before prefix checks. Do not block all
        // of 2001::/16: it includes ordinary public networks (e.g. Google DNS).
        const canonical = new URL(`https://[${address}]`).hostname.slice(1, -1);
        return !/^[23][0-9a-f]{3}:/i.test(canonical) ||
          /^(?:2002:|2001:(?::|0:|db8:)|3fff:)/i.test(canonical);
      })());
  })) throw new ValidationError(apiCopy("apiCopy.webdav.dns.resolved.to.a.non.public.address.50f48566"));
  const pinned = addresses[0]!;
  const dispatcher = new Agent({ headersTimeout: 120_000, bodyTimeout: 120_000, connect: {
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
    let stopped = false;
    const finish = async (cancel = false) => {
      if (stopped) return;
      stopped = true;
      try {
        if (cancel) await reader.cancel().catch(() => undefined);
      } finally {
        reader.releaseLock();
        await dispose();
      }
    };
    const body = new ReadableStream<Uint8Array>({
      async pull(controller) {
        if (stopped) return;
        try {
          const next = await reader.read();
          if (stopped) return;
          if (next.done) { controller.close(); await finish(); }
          else controller.enqueue(next.value);
        } catch {
          if (!stopped) controller.error(new BusinessError(apiCopy("apiCopy.webdav.stream.failed.53b785d4")));
          await finish(true);
        }
      },
      cancel() { return finish(true); },
    });
    return new Response(body, { status: upstream.status, headers: Object.fromEntries(upstream.headers) });
  } catch { await dispose(); throw new BusinessError(apiCopy("apiCopy.webdav.connection.or.tls.verification.failed.f934e8dd")); }
};

function segments(path: string): string[] {
  if (typeof path !== "string" || /[\\\x00-\x1f\x7f]/.test(path) || /%(?:2e|2f|5c|25|00)/i.test(path)) throw new ValidationError(apiCopy("apiCopy.invalid.webdav.path.386971e6"));
  const parts = path.split("/").filter(Boolean);
  if (parts.some((p) => p === "." || p === "..")) throw new ValidationError(apiCopy("apiCopy.webdav.path.exceeds.root.3a72fb06"));
  return parts;
}
async function limited(response: Response, maxBytes: number): Promise<Buffer> {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 0) { await response.body?.cancel(); throw new ValidationError(apiCopy("apiCopy.invalid.webdav.read.limit.e5c775df")); }
  if (Number(response.headers.get("content-length")) > maxBytes) { await response.body?.cancel(); throw new BusinessError(apiCopy("apiCopy.webdav.response.too.large.b996a780")); }
  const reader = response.body?.getReader();
  if (!reader) return Buffer.alloc(0);
  const chunks: Uint8Array[] = []; let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read(); if (done) break;
      total += value.byteLength;
      if (total > maxBytes) throw new BusinessError(apiCopy("apiCopy.webdav.response.too.large.b996a780"));
      chunks.push(value);
    }
    return Buffer.concat(chunks, total);
  } catch (error) { if (error instanceof BusinessError) throw error; throw new BusinessError(apiCopy("apiCopy.webdav.response.read.failed.882a7d4d")); }
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
    // Deadline only for DNS/connection/response headers; a progressing download
    // must not be aborted after a fixed wall-clock duration. The pinned Agent
    // separately enforces connect and body inactivity timeouts.
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 120_000);
    timer.unref?.();
    try {
      response = await transport(url, { method, headers: { Authorization: authorization, ...headers }, ...(body !== undefined ? { body: body as BodyInit } : {}), redirect: "manual", signal: controller.signal });
    } catch { throw new BusinessError(apiCopy("apiCopy.webdav.connection.dns.policy.or.tls.verification.failed.a9bf97a9")); }
    finally { clearTimeout(timer); }
    if (!response.ok) { await response.body?.cancel().catch(() => undefined); throw new WebDavHttpError(response.status); }
    return response;
  }
  async function propfind(path: string, depth: "0" | "1"): Promise<WebDavEntry[]> {
    const response = await request("PROPFIND", path, { Depth: depth, "Content-Type": "application/xml; charset=utf-8" }, '<?xml version="1.0"?><d:propfind xmlns:d="DAV:"><d:prop><d:resourcetype/><d:getcontentlength/><d:getlastmodified/></d:prop></d:propfind>');
    const xml = (await limited(response, XML_LIMIT)).toString("utf8");
    if (/<!DOCTYPE|<!ENTITY/i.test(xml) || XMLValidator.validate(xml) !== true) throw new BusinessError(apiCopy("apiCopy.invalid.webdav.xml.response.d22c80c4"));
    const parsed = object(new XMLParser({ removeNSPrefix: true, parseTagValue: false, processEntities: true }).parse(xml));
    if (!parsed.multistatus) throw new BusinessError(apiCopy("apiCopy.invalid.webdav.multistatus.response.d057cca7"));
    const rows = array(object(parsed.multistatus).response);
    if (rows.length > 5000) throw new BusinessError(apiCopy("apiCopy.webdav.directory.too.large.f2d6a62f"));
    const entries: WebDavEntry[] = [];
    for (const raw of rows) {
      const row = object(raw);
      const href = row.href;
      if (typeof href !== "string") throw new BusinessError(apiCopy("apiCopy.invalid.webdav.response.path.9dd501dc"));
      let decoded: string;
      try {
        const url = new URL(href, target(path));
        if (url.origin !== endpoint.origin || url.username || url.password || url.hash || url.search) throw new Error();
        decoded = decodeURIComponent(url.pathname).replace(/\/+$/, "");
        const decodedRoot = decodeURIComponent(rootPath);
        if (decoded !== decodedRoot && !decoded.startsWith(decodedRoot + "/")) throw new Error();
        decoded = segments(decoded.slice(decodedRoot.length)).join("/");
      } catch { throw new BusinessError(apiCopy("apiCopy.webdav.response.path.exceeds.root.9350471c")); }
      const requested = segments(path).join("/");
      if (decoded !== requested && !(depth === "1" && decoded.startsWith(requested ? requested + "/" : "") && !decoded.slice(requested ? requested.length + 1 : 0).includes("/"))) throw new BusinessError(apiCopy("apiCopy.webdav.response.path.exceeds.requested.directory.c8322bb0"));
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
      if (!Number.isSafeInteger(size) || size < 0) throw new BusinessError(apiCopy("apiCopy.invalid.webdav.file.size.088f4b9f"));
      entries.push({ relativePath: decoded, name: decoded.split("/").at(-1) ?? "", isDirectory: Object.hasOwn(object(props.resourcetype), "collection"), size, lastModifiedMs: Date.parse(String(props.getlastmodified)) || 0 });
    }
    return entries;
  }
  async function mutate(method: string, path: string, headers?: Record<string, string>, body?: Buffer | string) {
    if (!segments(path).length) throw new ValidationError(apiCopy("apiCopy.cannot.mutate.webdav.root.path.88a93cad"));
    const response = await request(method, path, headers, body);
    // DELETE/MOVE may report partial failure as 207: never claim success for it.
    await response.body?.cancel().catch(() => undefined);
    if (response.status === 207) throw new BusinessError(apiCopy("apiCopy.webdav.operation.returned.partial.multistatus.completion.not.con.c8ca2522"));
  }
  return {
    async list(path = ""): Promise<WebDavEntry[]> {
      const key = segments(path).join("/");
      const entries = await propfind(path, "1");
      // A missing collection row is an incomplete inventory, not an empty directory.
      if (!entries.some((e) => e.relativePath === key && e.isDirectory)) throw new WebDavHttpError(502);
      return entries.filter((e) => e.relativePath !== key);
    },
    async stat(path: string): Promise<WebDavEntry | null> { try { const entries = await propfind(path, "0"); if (!entries[0]) throw new BusinessError(apiCopy("apiCopy.empty.webdav.stat.response.3856e537")); return entries[0]; } catch (e) { if (e instanceof WebDavHttpError && e.status === 404) return null; throw e; } },
    async read(path: string, maxBytes = READ_LIMIT): Promise<Buffer> { return limited(await request("GET", path), maxBytes); },
    async stream(path: string, range?: { start: number; end: number }, expectedSize?: number): Promise<ReadableStream<Uint8Array>> {
      if (range && (!Number.isSafeInteger(range.start) || !Number.isSafeInteger(range.end) || range.start < 0 || range.end < range.start || !Number.isSafeInteger(range.end + 1))) throw new ValidationError(t("backend.webdav.rangeInvalid"));
      if (expectedSize !== undefined && (!Number.isSafeInteger(expectedSize) || expectedSize < 0 || (range && range.end >= expectedSize))) throw new ValidationError(t("backend.webdav.rangeInvalid"));
      const response = await request("GET", path, { "Accept-Encoding": "identity", ...(range ? { Range: `bytes=${range.start}-${range.end}` } : {}) });
      const reject = async () => { await response.body?.cancel().catch(() => undefined); throw new BusinessError(t("backend.webdav.rangeInvalid")); };
      const encoding = response.headers.get("content-encoding");
      if ((encoding && encoding.toLowerCase() !== "identity") || ![200, 206].includes(response.status)) return reject();
      let skip = range?.start ?? 0;
      let length = range ? range.end - range.start + 1 : expectedSize;
      if (response.status === 206) {
        const match = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(response.headers.get("content-range") ?? "");
        if (!range || !match) return reject();
        const [start, end, total] = match.slice(1).map(Number) as [number, number, number];
        if (![start, end, total].every(Number.isSafeInteger) || start !== range.start || end !== range.end || total <= end || (expectedSize !== undefined && total !== expectedSize)) return reject();
        skip = 0;
      } else if (response.headers.has("content-range")) return reject();
      const contentLength = response.headers.get("content-length");
      const fullLength = response.status === 206 ? length : expectedSize;
      if (contentLength !== null && (!/^\d+$/.test(contentLength) || !Number.isSafeInteger(Number(contentLength)) || (fullLength !== undefined && Number(contentLength) !== fullLength))) return reject();
      const reader = response.body?.getReader();
      let stopped = false;
      const finish = async (cancel = false) => {
        if (stopped) return;
        stopped = true;
        try {
          if (cancel) await reader?.cancel().catch(() => undefined);
        } finally { reader?.releaseLock(); }
      };
      // 200 fallback skips locally with bounded memory and cancels as soon as
      // the selection is complete. 206 must match both its headers and body.
      const fallback = response.status === 200 && !!range;
      return new ReadableStream<Uint8Array>({
        async pull(controller) {
          if (stopped) return;
          if (!reader) { if (length) controller.error(new BusinessError(t("backend.webdav.rangeTruncated"))); else controller.close(); return; }
          try {
            for (;;) {
              const next = await reader.read();
              if (stopped) return;
              if (next.done) {
                if (skip || (length !== undefined && length !== 0)) throw new BusinessError(t("backend.webdav.rangeTruncated"));
                controller.close(); await finish(); return;
              }
              const discarded = Math.min(skip, next.value.length); skip -= discarded;
              const bytes = next.value.subarray(discarded);
              if (!fallback && length !== undefined && bytes.length > length) throw new BusinessError(t("backend.webdav.rangeOversized"));
              const selected = length === undefined ? bytes : bytes.subarray(0, length);
              if (length !== undefined) length -= selected.length;
              if (selected.length) controller.enqueue(selected);
              if (fallback && length === 0) { controller.close(); await finish(true); return; }
              if (selected.length) return;
            }
          } catch (error) {
            if (!stopped) controller.error(error instanceof BusinessError ? error : new BusinessError(apiCopy("apiCopy.webdav.stream.failed.53b785d4")));
            await finish(true);
          }
        },
        cancel() { return finish(true); },
      });
    },
    async write(path: string, content: string | Buffer): Promise<{ byteSize: number }> { const body = Buffer.isBuffer(content) ? content : Buffer.from(content); await mutate("PUT", path, { "Content-Type": "application/octet-stream" }, body); return { byteSize: body.length }; },
    async mkdir(path: string): Promise<void> { await mutate("MKCOL", path); },
    async copy(oldPath: string, newPath: string): Promise<void> { if (!segments(newPath).length) throw new ValidationError(apiCopy("apiCopy.cannot.replace.webdav.root.path.eaa87e14")); await mutate("COPY", oldPath, { Destination: target(newPath).href.replace(/\/$/, ""), Overwrite: "F", Depth: "0" }); },
    async delete(path: string): Promise<void> { await mutate("DELETE", path); },
    async rename(oldPath: string, newPath: string): Promise<void> { if (!segments(newPath).length) throw new ValidationError(apiCopy("apiCopy.cannot.replace.webdav.root.path.eaa87e14")); await mutate("MOVE", oldPath, { Destination: target(newPath).href.replace(/\/$/, ""), Overwrite: "F" }); },
  };
}
export type WebDavClient = ReturnType<typeof createWebDavClient>;
