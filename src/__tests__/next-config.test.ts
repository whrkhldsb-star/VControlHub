import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

import { describe, expect, it } from "vitest";

import nextConfig from "../../next.config";
import { CHAT_REQUEST_MAX_BODY_BYTES } from "@/lib/ai/schema";
import { PROXY_CLIENT_MAX_BODY_BYTES } from "@/lib/http/proxy-body-limit";
import { CONFIG_IMPORT_MAX_BODY_BYTES } from "@/lib/system/config-schema";
import { MAX_CHUNK_SIZE, MAX_IMAGE_UPLOAD_BYTES } from "@/lib/upload/types";

const require = createRequire(import.meta.url);

describe("Next.js production config", () => {
  it("does not enable standalone output while the custom server owns production startup", () => {
    expect(nextConfig).not.toHaveProperty("output", "standalone");
  });

  it("does not announce the framework in every response", () => {
    expect(nextConfig.poweredByHeader).toBe(false);
  });

  it("does not give API responses a max-age: the browser cache is keyed on the URL, not the user or customer", async () => {
    const rules = await nextConfig.headers!();
    const apiRules = rules.filter((rule) => rule.source.startsWith("/api"));
    expect(apiRules).toEqual([]);
  });

  // Next hands a route behind the proxy only the first proxyClientMaxBodySize
  // bytes of its body (10 MB when unset) and lets the request carry on: with
  // the default, an AI chat message with two screenshots, a configuration
  // import or an image over 10 MB failed as "not valid JSON" / "Failed to
  // parse body as FormData", whatever limit the route itself declared.
  describe("request bodies behind the proxy", () => {
    it("lets through what next.config.ts and the routes agree on", () => {
      expect(nextConfig.experimental?.proxyClientMaxBodySize).toBe(PROXY_CLIENT_MAX_BODY_BYTES);
    });

    it("lets through every body a proxied route accepts", () => {
      const multipartOverhead = 1024 * 1024;
      const proxiedRouteLimits = {
        "AI chat (attachments travel as base64)": CHAT_REQUEST_MAX_BODY_BYTES,
        "configuration import": CONFIG_IMPORT_MAX_BODY_BYTES,
        "image upload": MAX_IMAGE_UPLOAD_BYTES + multipartOverhead,
        "upload chunk": MAX_CHUNK_SIZE,
      };
      for (const [route, limit] of Object.entries(proxiedRouteLimits)) {
        expect(limit, route).toBeLessThanOrEqual(PROXY_CLIENT_MAX_BODY_BYTES);
      }
    });

    it("is an option this Next.js version still reads", () => {
      // The option is experimental and has been renamed once already
      // (middlewareClientMaxBodySize). If an upgrade drops it, the limit above
      // silently falls back to 10 MB: find the new name before shipping.
      const schema = readFileSync(require.resolve("next/dist/server/config-schema.js"), "utf8");
      expect(schema).toContain("proxyClientMaxBodySize");
    });
  });
});
