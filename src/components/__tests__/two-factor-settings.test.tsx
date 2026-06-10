import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { TwoFactorSettings } from "../two-factor-settings";
import { csrfFetch } from "@/lib/auth/csrf-client";

const refreshMock = vi.fn();

vi.mock("next/image", () => ({
	// eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text
	default: ({ unoptimized: _unoptimized, ...props }: React.ImgHTMLAttributes<HTMLImageElement> & { unoptimized?: boolean }) => <img {...props} />,
}));

vi.mock("@/lib/auth/csrf-client", () => ({
	csrfFetch: vi.fn(),
}));

vi.mock("next/navigation", () => ({
	useRouter: () => ({ refresh: refreshMock }),
}));

describe("TwoFactorSettings", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		refreshMock.mockReset();
		Object.defineProperty(window, "location", {
			value: { reload: vi.fn() },
			writable: true,
		});
	});

	it("surfaces setup API failures with the backend message", async () => {
		const user = userEvent.setup();
		vi.mocked(csrfFetch).mockRejectedValueOnce(new Error("二维码生成失败"));

		render(<TwoFactorSettings enabled={false} />);

		await user.click(screen.getByRole("button", { name: "开启两步验证" }));

		expect(await screen.findByRole("alert")).toHaveTextContent("二维码生成失败");
		expect(screen.getByRole("button", { name: "开启两步验证" })).toBeEnabled();
	});

	it("keeps the setup panel open when enabling 2FA fails", async () => {
		const user = userEvent.setup();
		vi.mocked(csrfFetch)
			.mockResolvedValueOnce({ secret: "ABC123", otpauthUrl: "otpauth://totp/demo" })
			.mockResolvedValueOnce({ valid: true })
			.mockRejectedValueOnce(new Error("启用失败"));

		render(<TwoFactorSettings enabled={false} />);

		await user.click(screen.getByRole("button", { name: "开启两步验证" }));
		expect(await screen.findByText("密钥（手动输入）：")).toBeInTheDocument();
		await user.type(screen.getByLabelText("6位验证码"), "123456");
		await user.click(screen.getByRole("button", { name: "确认启用" }));

		expect(await screen.findByRole("alert")).toHaveTextContent("启用失败");
		expect(screen.getByText("密钥（手动输入）：")).toBeInTheDocument();
		expect(screen.getByRole("button", { name: "确认启用" })).toBeEnabled();
		expect(window.location.reload).not.toHaveBeenCalled();
		expect(refreshMock).not.toHaveBeenCalled();
	});

	it("refreshes server-rendered settings after successfully enabling 2FA without a full reload", async () => {
		const user = userEvent.setup();
		vi.mocked(csrfFetch)
			.mockResolvedValueOnce({ secret: "ABC123", otpauthUrl: "otpauth://totp/demo" })
			.mockResolvedValueOnce({ valid: true })
			.mockResolvedValueOnce({ success: true });

		render(<TwoFactorSettings enabled={false} />);

		await user.click(screen.getByRole("button", { name: "开启两步验证" }));
		await user.type(await screen.findByLabelText("6位验证码"), "123456");
		await user.click(screen.getByRole("button", { name: "确认启用" }));

		expect(refreshMock).toHaveBeenCalledTimes(1);
		expect(window.location.reload).not.toHaveBeenCalled();
	});

	it("surfaces disable API failures and keeps the disable panel open", async () => {
		const user = userEvent.setup();
		vi.mocked(csrfFetch).mockRejectedValueOnce(new Error("关闭失败"));

		render(<TwoFactorSettings enabled={true} />);

		await user.click(screen.getByRole("button", { name: "关闭两步验证" }));
		await user.type(screen.getByLabelText("当前验证码"), "654321");
		await user.click(screen.getByRole("button", { name: "确认关闭" }));

		expect(await screen.findByRole("alert")).toHaveTextContent("关闭失败");
		expect(screen.getByRole("button", { name: "确认关闭" })).toBeEnabled();
		expect(window.location.reload).not.toHaveBeenCalled();
		expect(refreshMock).not.toHaveBeenCalled();
	});

	it("refreshes server-rendered settings after successfully disabling 2FA without a full reload", async () => {
		const user = userEvent.setup();
		vi.mocked(csrfFetch).mockResolvedValueOnce({ success: true });

		render(<TwoFactorSettings enabled={true} />);

		await user.click(screen.getByRole("button", { name: "关闭两步验证" }));
		await user.type(screen.getByLabelText("当前验证码"), "654321");
		await user.click(screen.getByRole("button", { name: "确认关闭" }));

		expect(refreshMock).toHaveBeenCalledTimes(1);
		expect(window.location.reload).not.toHaveBeenCalled();
	});
});
