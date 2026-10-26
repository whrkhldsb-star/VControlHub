// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";

const getSetting = vi.hoisted(() => vi.fn<(key: string) => Promise<string>>());
vi.mock("@/lib/settings/service", () => ({ getSetting }));

import { rdpImageMimetypes } from "@/lib/rdp/features";

describe("RDP image formats", () => {
	afterEach(() => { vi.unstubAllEnvs(); getSetting.mockReset(); });

	it("offers WebP when the setting is on, whatever the environment says", async () => {
		vi.stubEnv("RDP_WEBP_IMAGES", "false");
		getSetting.mockResolvedValue("true");
		expect(await rdpImageMimetypes()).toEqual(["image/png", "image/jpeg", "image/webp"]);
		expect(getSetting).toHaveBeenCalledWith("rdp.webpImages");
	});

	it("leaves WebP out when the setting is off, whatever the environment says", async () => {
		vi.stubEnv("RDP_WEBP_IMAGES", "true");
		getSetting.mockResolvedValue("false");
		expect(await rdpImageMimetypes()).toEqual(["image/png", "image/jpeg"]);
	});

	it("follows RDP_WEBP_IMAGES while the setting is empty, and is off without either", async () => {
		getSetting.mockResolvedValue("");
		expect(await rdpImageMimetypes()).toEqual(["image/png", "image/jpeg"]);
		vi.stubEnv("RDP_WEBP_IMAGES", "true");
		expect(await rdpImageMimetypes()).toEqual(["image/png", "image/jpeg", "image/webp"]);
	});

	it("keeps PNG and JPEG when the setting cannot be read", async () => {
		getSetting.mockRejectedValue(new Error("database down"));
		expect(await rdpImageMimetypes()).toEqual(["image/png", "image/jpeg"]);
	});
});
