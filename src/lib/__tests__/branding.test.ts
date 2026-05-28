import { describe, expect, it } from "vitest";

import { getAppMetadataTitle, getAppName, getAppSlug, getPublicLabel, getSiteName } from "../branding";

describe("branding helpers", () => {
  it("uses stable defaults when env is empty", () => {
    expect(getAppName({} as NodeJS.ProcessEnv)).toBe("VControlHub");
    expect(getAppSlug({} as NodeJS.ProcessEnv)).toBe("vcontrolhub");
    expect(getSiteName({} as NodeJS.ProcessEnv)).toBe("VPS 统一管控平台");
    expect(getPublicLabel({} as NodeJS.ProcessEnv)).toBe("VPS 管理与分布式云盘");
    expect(getAppMetadataTitle({} as NodeJS.ProcessEnv)).toBe("VPS 统一管控平台 | 统一 VPS 管理、审批执行、分布式云盘与媒体浏览平台");
  });

	it("falls back to the generic public label when env uses app branding tokens or install domain", () => {
		const env = {
			NODE_ENV: "test",
			APP_NAME: "WHRKHLDsb",
			APP_SLUG: "whrkhldsb",
			NEXT_PUBLIC_APP_PUBLIC_LABEL: "WHRKHLDsb",
		} as NodeJS.ProcessEnv;

		expect(getPublicLabel(env)).toBe("VPS 管理与分布式云盘");
		expect(getPublicLabel({ ...env, NEXT_PUBLIC_APP_PUBLIC_LABEL: "whrkhldsb.qzz.io" })).toBe("VPS 管理与分布式云盘");
	});

	it("respects env overrides and normalizes the slug", () => {
		const env = {
			NODE_ENV: "test",
			APP_NAME: "My App",
			APP_SLUG: "My App!!",
			SITE_NAME: "云盘中心",
			NEXT_PUBLIC_APP_PUBLIC_LABEL: "统一入口",
		} as NodeJS.ProcessEnv;

    expect(getAppName(env)).toBe("My App");
    expect(getAppSlug(env)).toBe("my-app");
    expect(getSiteName(env)).toBe("云盘中心");
    expect(getPublicLabel(env)).toBe("统一入口");
    expect(getAppMetadataTitle(env)).toBe("云盘中心 | 统一 VPS 管理、审批执行、分布式云盘与媒体浏览平台");
  });
});
