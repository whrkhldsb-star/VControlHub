// @vitest-environment node
import sharp from "sharp";
import { expect, it, vi } from "vitest";
import { fetchWithPinnedDns } from "@/lib/security/pinned-fetch";
import { resolvePlatformLogo } from "./platform-logo";

vi.mock("@/lib/security/pinned-fetch", () => ({ fetchWithPinnedDns: vi.fn() }));

it("renders site paths directly and resolves a public logo once for the favicon and navigation", async () => {
  expect(await resolvePlatformLogo("https://hub.example/brand.png?v=2", "hub.example")).toBe("/brand.png?v=2");
  expect(await resolvePlatformLogo("/brand.svg", "hub.example")).toBe("/brand.svg");
  expect(await resolvePlatformLogo("https://user:pass@cdn.example/logo.png", "hub.example")).toBeUndefined();
  expect(fetchWithPinnedDns).not.toHaveBeenCalled();
  const png = await sharp({ create: { width: 128, height: 64, channels: 4, background: "#334455" } }).png().toBuffer();
  vi.mocked(fetchWithPinnedDns).mockResolvedValueOnce(new Response(new Uint8Array(png), { headers: { "content-type": "image/png" } }));
  const url = "https://cdn.example/brand.png";
  const [navigation, favicon] = await Promise.all([resolvePlatformLogo(url, "hub.example"), resolvePlatformLogo(url, "hub.example")]);
  expect(fetchWithPinnedDns).toHaveBeenCalledOnce();
  expect(fetchWithPinnedDns).toHaveBeenCalledWith(new URL(url), expect.objectContaining({ method: "GET", redirect: "error" }));
  expect(favicon).toBe(navigation);
  expect(navigation).toMatch(/^data:image\/png;base64,/);
  expect(await sharp(Buffer.from(navigation!.split(",")[1]!, "base64")).metadata()).toMatchObject({ width: 64, height: 32 });
});

it("falls back when an external logo is inaccessible, has the wrong media type or exceeds the byte budget", async () => {
  vi.mocked(fetchWithPinnedDns)
    .mockRejectedValueOnce(new Error("non-public address"))
    .mockResolvedValueOnce(new Response("<html>", { headers: { "content-type": "text/html" } }))
    .mockResolvedValueOnce(new Response(new Uint8Array(2 * 1024 * 1024 + 1), { headers: { "content-type": "image/png" } }));
  for (const name of ["unavailable", "html", "large"]) {
    expect(await resolvePlatformLogo("https://cdn.example/" + name, "hub.example")).toBeUndefined();
  }
});
