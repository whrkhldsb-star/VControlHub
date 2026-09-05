import { afterEach, describe, expect, it, vi } from "vitest";
import { encrypt } from "@/lib/crypto/service";
import { resolveStorageWebDavCredentials } from "../webdav-credentials";

afterEach(() => vi.unstubAllEnvs());
describe("WebDAV persisted node configuration compatibility", () => {
  it("resolves the url-based configuration saved by service-nodes", () => {
    vi.stubEnv("ENCRYPTION_KEY", "webdav-compat-fixture");
    const webdavConfigEncrypted = encrypt(JSON.stringify({ url: "https://dav.example.com/root", authType: "basic", username: "alice", password: "secret" }));
    expect(resolveStorageWebDavCredentials({ webdavConfigEncrypted })).toEqual({ endpoint: "https://dav.example.com/root", authType: "basic", username: "alice", password: "secret" });
  });
});
