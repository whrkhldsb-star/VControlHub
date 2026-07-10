import { describe, expect, it, vi } from "vitest";

vi.mock("node:crypto", () => ({
	default: {
		randomBytes: () => ({ toString: () => "generated-password" }),
	},
}));

const { buildInstallNotice, formatInstallNoticeMessage, prepareInstallSecrets } = await import("../install-notice");
const { SERVICE_CATALOG } = await import("../catalog");
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
			{ label: "Account", value: "admin" },
			{ label: "Initial password", value: "generated-password" },
		]);
		expect(prepared.notes[0]).toContain("AList");
	});

	it("generates random default credentials for templates with unsafe placeholders", () => {
		const minio = prepareInstallSecrets(SERVICE_CATALOG.find((template: ServiceTemplate) => template.slug === "minio")!);
		const n8n = prepareInstallSecrets(SERVICE_CATALOG.find((template: ServiceTemplate) => template.slug === "n8n")!);
		const pihole = prepareInstallSecrets(SERVICE_CATALOG.find((template: ServiceTemplate) => template.slug === "pihole")!);
		const halo = prepareInstallSecrets(SERVICE_CATALOG.find((template: ServiceTemplate) => template.slug === "halo")!);

		expect(minio.template.envJson.MINIO_ROOT_PASSWORD).toBe("generated-password");
		expect(minio.credentials).toEqual([
			{ label: "Account", value: "minioadmin" },
			{ label: "Initial password", value: "generated-password" },
		]);
		expect(n8n.template.envJson.N8N_BASIC_AUTH_PASSWORD).toBe("generated-password");
		expect(pihole.template.envJson.WEBPASSWORD).toBe("generated-password");
		expect(halo.template.envJson.HALO_SECURITY_INITIALIZER_SUPERADMINPASSWORD).toBe("generated-password");
	});

	it("generates missing passwords for password-protected apps", () => {
		const codeServer = prepareInstallSecrets(SERVICE_CATALOG.find((template: ServiceTemplate) => template.slug === "code-server")!);
		expect(codeServer.template.envJson.PASSWORD).toBe("generated-password");
		expect(codeServer.template.envJson.SUDO_PASSWORD).toBe("");
		expect(codeServer.credentials).toEqual([{ label: "Initial password", value: "generated-password" }]);
	});

	it("reports setup guidance for every built-in catalog app", () => {
		for (const template of SERVICE_CATALOG) {
			const prepared = prepareInstallSecrets(template);
			expect(prepared.credentials.length + prepared.notes.length, template.slug).toBeGreaterThan(0);
			const notice = buildInstallNotice(prepared.template, prepared.template.defaultPort, prepared.credentials, prepared.notes);
			const message = formatInstallNoticeMessage(prepared.template.name, notice);
			expect(message, template.slug).toContain("has been installed and started successfully");
			expect(message, template.slug).toMatch(/Initial login information:/);
		}
	});

	it("falls back to a generic setup note for remote or unknown apps", () => {
		const prepared = prepareInstallSecrets({ ...baseTemplate, slug: "custom-app", name: "Custom App" });
		expect(prepared.credentials).toEqual([]);
		expect(prepared.notes[0]).toContain("This app does not declare fixed initial credentials; please complete initialization per the first-launch page or container logs.");
	});

	it("formats success notices with access URL and credentials", () => {
		process.env.NEXT_PUBLIC_QUICK_SERVICE_PUBLIC_HOST = "82.158.91.159";
		const notice = buildInstallNotice({ ...baseTemplate, defaultPort: 5244 }, 5244, [{ label: "Initial password", value: "secret" }], ["Please change the password after first login."]);
		const message = formatInstallNoticeMessage("AList 云盘", notice);

		expect(notice.accessUrl).toBe("http://82.158.91.159:5244/");
		expect(message).toContain("AList 云盘 has been installed and started successfully");
		expect(message).toContain("Access URL: http://82.158.91.159:5244/");
		expect(message).toContain("Initial password: secret");
		expect(message).toContain("Please change the password after first login.");
	});
});
