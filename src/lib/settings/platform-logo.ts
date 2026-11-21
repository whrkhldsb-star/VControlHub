import { Readable } from "node:stream";
import { fetchWithPinnedDns } from "@/lib/security/pinned-fetch";
import { isPlatformLogoUrl } from "./schema";

const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
let cached: { url: string; until: number; image: Promise<string | undefined> } | undefined;

// The browser permits same-origin and data: images. Fetch only the configured
// public image, without cookies or redirects, and return a small static icon.
async function loadPublicLogo(url: URL) {
  const response = await fetchWithPinnedDns(url, { method: "GET", redirect: "error", signal: AbortSignal.timeout(4_000) });
  const body = response.body;
  if (!body) return;
  if (!response.ok || !response.headers.get("content-type")?.toLowerCase().startsWith("image/") ||
      Number(response.headers.get("content-length")) > MAX_IMAGE_BYTES) {
    await body.cancel();
    return;
  }
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of Readable.fromWeb(body as import("node:stream/web").ReadableStream<Uint8Array>)) {
    size += chunk.length;
    if (size > MAX_IMAGE_BYTES) return;
    chunks.push(chunk);
  }
  const sharp = (await import("sharp")).default;
  const image = await sharp(Buffer.concat(chunks, size), { limitInputPixels: 4096 * 4096 })
    .resize(64, 64, { fit: "inside", withoutEnlargement: true }).png().toBuffer();
  return "data:image/png;base64," + image.toString("base64");
}

export async function resolvePlatformLogo(source: string | undefined, requestHost: string | null) {
  if (!source || !isPlatformLogoUrl(source)) return;
  if (source.startsWith("/")) return source;
  const url = new URL(source);
  if (url.host === requestHost?.toLowerCase()) return "/" + url.pathname.replace(/^\/+/, "") + url.search + url.hash;
  if (!cached || cached.url !== source || Date.now() >= cached.until) {
    cached = { url: source, until: Date.now() + 60_000, image: loadPublicLogo(url).catch(() => undefined) };
  }
  return cached.image;
}
