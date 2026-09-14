import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "@/lib/i18n/provider";
import { ApiError } from "@/lib/http/api-client-error";

const { fetchMock, pushMock } = vi.hoisted(() => ({ fetchMock: vi.fn(), pushMock: vi.fn() }));
vi.mock("@/lib/auth/csrf-client", () => ({ csrfFetch: fetchMock }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: pushMock }) }));

import { Verify2faForm } from "../verify-2fa-form";

function enterCode(code: string) {
	const inputs = screen.getAllByRole("textbox");
	for (let index = 0; index < code.length; index++) {
		fireEvent.change(inputs[index]!, { target: { value: code[index] } });
	}
}

describe("two-factor verification feedback", () => {
	beforeEach(() => { vi.resetAllMocks(); });

	it("shows a rejected challenge's API message and allows a successful retry", async () => {
		fetchMock.mockRejectedValueOnce(new ApiError(400, { error: "Invalid verification code" }));
		fetchMock.mockResolvedValueOnce({ success: true });
		render(<I18nProvider initialLocale="en"><Verify2faForm nextPath="/servers" /></I18nProvider>);
		enterCode("123456");
		expect(await screen.findByRole("alert")).toHaveTextContent("Invalid verification code");
		expect(pushMock).not.toHaveBeenCalled();
		enterCode("654321");
		await waitFor(() => expect(pushMock).toHaveBeenCalledWith("/servers"));
		expect(screen.queryByRole("alert")).not.toBeInTheDocument();
	});

	it("keeps the localized network fallback for transport failures", async () => {
		fetchMock.mockRejectedValueOnce(new TypeError("Failed to fetch"));
		render(<I18nProvider initialLocale="en"><Verify2faForm nextPath="/" /></I18nProvider>);
		enterCode("123456");
		expect(await screen.findByRole("alert")).toHaveTextContent(/network/i);
		expect(screen.getByRole("button", { name: /^Verify$/i })).toBeEnabled();
	});
});
