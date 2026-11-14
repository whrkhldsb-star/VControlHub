import { fireEvent, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { csrfFetch } from "@/lib/auth/csrf-client";
import { renderWithI18n } from "@/lib/i18n/__tests__/test-helpers";

import { InstallDialog } from "../install-dialog";

vi.mock("@/lib/auth/csrf-client", () => ({ csrfFetch: vi.fn() }));

const item = { slug: "alist", name: "AList", image: "xhofe/alist:latest", defaultPort: 5244 };

function renderDialog() {
	return renderWithI18n(
		<InstallDialog open={item} targetLabel="平台本机" onClose={() => undefined} onAdvance={() => undefined}
			getEnvCount={() => 0} getVolumeMounts={() => []} getPrimaryContainerPort={() => 5244} />,
	);
}

describe("InstallDialog port check", () => {
	beforeEach(() => {
		vi.mocked(csrfFetch).mockReset();
	});

	it("says a check that failed has failed, not that the port is in use", async () => {
		// The reason of the failure went into the "used by" slot: "已占用 / 端口被占用：无法连接到服务器…" for a
		// port nobody had looked at.
		vi.mocked(csrfFetch).mockRejectedValueOnce(new Error("无法连接到服务器，请检查网络后重试"));
		renderDialog();
		expect(await screen.findByText("无法检查端口：无法连接到服务器，请检查网络后重试")).toBeInTheDocument();
		expect(screen.queryByText("已占用")).not.toBeInTheDocument();
		expect(screen.queryByText(/端口被占用/)).not.toBeInTheDocument();
		expect(screen.getByRole("button", { name: "下一步" })).toBeDisabled();

		// Asking again is one click.
		vi.mocked(csrfFetch).mockResolvedValueOnce({ available: true });
		fireEvent.click(screen.getByRole("button", { name: "重新检查" }));
		expect(await screen.findByText("可用")).toBeInTheDocument();
		expect(screen.getByRole("button", { name: "下一步" })).toBeEnabled();
	});

	it("still says who uses a port that is taken", async () => {
		vi.mocked(csrfFetch).mockResolvedValueOnce({ available: false, usedBy: "nginx" });
		renderDialog();
		expect(await screen.findByText("已占用")).toBeInTheDocument();
		expect(screen.getByText("端口被占用：nginx")).toBeInTheDocument();
	});

	it("does not ask about a port that is not a whole number", async () => {
		vi.mocked(csrfFetch).mockResolvedValue({ available: true });
		renderDialog();
		await screen.findByText("可用");
		const calls = vi.mocked(csrfFetch).mock.calls.length;
		fireEvent.change(screen.getByLabelText("端口号"), { target: { value: "80.5" } });
		await new Promise((resolve) => setTimeout(resolve, 500));
		expect(vi.mocked(csrfFetch).mock.calls.length).toBe(calls);
		expect(screen.getByRole("button", { name: "下一步" })).toBeDisabled();
	});

	it("says so when no free port could be assigned", async () => {
		vi.mocked(csrfFetch).mockResolvedValueOnce({ available: true }).mockRejectedValueOnce(new Error("目标服务器不可达"));
		renderDialog();
		await screen.findByText("可用");
		fireEvent.click(screen.getByRole("button", { name: "自动分配" }));
		await waitFor(() => expect(screen.getByText("无法检查端口：目标服务器不可达")).toBeInTheDocument());
	});
});
