import { describe, expect, it, vi } from "vitest";

vi.mock("node:crypto", () => ({
	default: {
		randomBytes: () => ({ toString: () => "generated-password" }),
	},
}));

const { buildInstallNotice, formatInstallNoticeMessage, prepareInstallSecrets } = await import("../install-notice");
import type { ServiceTemplate } from "../types";

const baseTemplate: ServiceTemplate = {
	slug: "demo",
	name: "Demo",
	category: "other",
	icon: "box",
	description: "demo",
	image: "example/demo:latest",
	defaultPort: 8080,
	path: "/",
	envJson: {},
	volumesJson: [],
};

describe("quick service install notices", () => {
	it("generates an AList admin password before install", () => {
		const prepared = prepareInstallSecrets({ ...baseTemplate, slug: "alist", name: "AList 云盘", defaultPort: 5244 });

		expect(prepared.template.initialPassword).toBe("generated-password");
		expect(prepared.credentials).toEqual([
			{ label: "账号", value: "admin" },
			{ label: "初始密码", value: "generated-password" },
		]);
		expect(prepared.notes[0]).toContain("AList");
	});

	it("formats success notices with access URL and credentials", () => {
		process.env.NEXT_PUBLIC_QUICK_SERVICE_PUBLIC_HOST = "82.158.91.159";
		const notice = buildInstallNotice({ ...baseTemplate, defaultPort: 5244 }, 5244, [{ label: "初始密码", value: "secret" }], ["请首次登录后修改密码。"]);
		const message = formatInstallNoticeMessage("AList 云盘", notice);

		expect(notice.accessUrl).toBe("http://82.158.91.159:5244/");
		expect(message).toContain("AList 云盘 已安装并启动成功");
		expect(message).toContain("访问地址：http://82.158.91.159:5244");
		expect(message).toContain("初始密码：secret");
		expect(message).toContain("请首次登录后修改密码。");
	});
});
