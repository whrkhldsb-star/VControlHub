import { afterEach, describe, expect, it, vi } from "vitest";

async function loadConstants() {
  vi.resetModules();
  return import("../constants");
}

describe("image-bed constants", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("uses APP_DIR to scope uploaded image storage without relying on project root tracing", async () => {
    vi.stubEnv("APP_DIR", "/srv/example-app");

    const { UPLOAD_DIR } = await loadConstants();

    expect(UPLOAD_DIR).toBe("/srv/example-app/uploads/image-bed");
  });

	it("uses the production app dir as the deterministic default upload root", async () => {
		vi.stubEnv("APP_DIR", "");

		const { UPLOAD_DIR } = await loadConstants();

    expect(UPLOAD_DIR).toBe("/opt/whrkhldsb/uploads/image-bed");
  });

  it("allows IMAGE_UPLOAD_DIR to override the default upload location", async () => {
    vi.stubEnv("APP_DIR", "/srv/example-app");
    vi.stubEnv("IMAGE_UPLOAD_DIR", "/data/images");

    const { UPLOAD_DIR } = await loadConstants();

    expect(UPLOAD_DIR).toBe("/data/images");
  });
});
