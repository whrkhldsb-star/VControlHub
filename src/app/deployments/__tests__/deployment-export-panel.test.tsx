import { fireEvent, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { csrfFetch } from "@/lib/auth/csrf-client";
import { renderWithI18n } from "@/lib/i18n/__tests__/test-helpers";

import { DeploymentExportPanel } from "../deployment-export-panel";

vi.mock("@/lib/auth/csrf-client", () => ({ csrfFetch: vi.fn() }));

const mockedFetch = vi.mocked(csrfFetch);

const exported = {
	export: {
		id: "exp_1",
		name: "vcontrolhub-console",
		manifest: { domain: "console.example.com" },
		files: { "docker-compose.yml": "services: {}\n", "README.md": "# deploy\n" },
	},
};

async function generate() {
	mockedFetch.mockResolvedValueOnce(exported);
	renderWithI18n(<DeploymentExportPanel />);
	fireEvent.click(screen.getByRole("button", { name: "生成导出包" }));
	return screen.findByTestId("deploy-export-zip");
}

describe("DeploymentExportPanel", () => {
	beforeEach(() => mockedFetch.mockReset());

	it("says why the ZIP download was refused instead of printing the answer's body", async () => {
		// The body of a refusal is the error envelope; it was shown as it came: {"error":"…","code":"FORBIDDEN","message":"…"}.
		const zip = await generate();
		mockedFetch.mockResolvedValueOnce(
			new Response(JSON.stringify({ code: "FORBIDDEN", error: "Forbidden", message: "缺少权限: deployment:export" }), { status: 403 }) as never,
		);
		fireEvent.click(zip);
		const alert = await screen.findByRole("alert");
		expect(alert).toHaveTextContent("缺少权限: deployment:export");
		expect(alert).not.toHaveTextContent("FORBIDDEN");
		expect(alert).not.toHaveTextContent("{");
	});

	it("falls back to the status when the answer is not the app's", async () => {
		const zip = await generate();
		mockedFetch.mockResolvedValueOnce(new Response("<html><body>502 Bad Gateway</body></html>", { status: 502 }) as never);
		fireEvent.click(zip);
		const alert = await screen.findByRole("alert");
		expect(alert).toHaveTextContent("下载失败（HTTP 502）");
		expect(alert).not.toHaveTextContent("Bad Gateway");
	});
});
