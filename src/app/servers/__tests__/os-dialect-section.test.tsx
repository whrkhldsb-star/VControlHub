import { fireEvent, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { renderWithI18n } from "@/lib/i18n/__tests__/test-helpers";
import { ApiError, NetworkError } from "@/lib/http/api-client-error";

const csrfFetch = vi.hoisted(() => vi.fn());
vi.mock("@/lib/auth/csrf-client", () => ({ csrfFetch }));

import { OsDialectSection } from "../server-overview-detail-sections";

describe("OsDialectSection", () => {
	beforeEach(() => csrfFetch.mockReset());

	it("shows what the detection found", async () => {
		csrfFetch.mockResolvedValue({ osInfo: "Debian GNU/Linux 12", dialect: { packageManager: "apt", serviceManager: "systemd", distroName: "debian" } });
		renderWithI18n(<OsDialectSection serverId="srv 1" osDialect={null} osInfo={null} />);
		fireEvent.click(screen.getByRole("button", { name: "探测 OS" }));
		expect(await screen.findByText("Debian GNU/Linux 12")).toBeInTheDocument();
		expect(csrfFetch).toHaveBeenCalledWith("/api/servers/srv%201/detect-os", { method: "POST" });
	});

	it("says why the detection was refused, and tells a missing answer from a refusal", async () => {
		renderWithI18n(<OsDialectSection serverId="srv_1" osDialect={null} osInfo={null} />);

		csrfFetch.mockRejectedValueOnce(new ApiError(502, { error: "SSH 连接失败：认证被拒绝" }));
		fireEvent.click(screen.getByRole("button", { name: "探测 OS" }));
		expect(await screen.findByText("SSH 连接失败：认证被拒绝")).toBeInTheDocument();

		// Nothing answered: the sentence of the request helper, in the page's language.
		csrfFetch.mockRejectedValueOnce(new NetworkError("无法连接到服务器，请检查网络后重试"));
		fireEvent.click(screen.getByRole("button", { name: "探测 OS" }));
		expect(await screen.findByText("无法连接到服务器，请检查网络后重试")).toBeInTheDocument();

		// Anything without a reason: what failed. An answer that was not JSON used to be reported as "网络错误".
		csrfFetch.mockRejectedValueOnce(new Error(""));
		fireEvent.click(screen.getByRole("button", { name: "探测 OS" }));
		expect(await screen.findByText("探测失败")).toBeInTheDocument();
		expect(screen.queryByText("网络错误")).not.toBeInTheDocument();
	});
});
