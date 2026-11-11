import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "@/lib/i18n/provider";
import { ApiError } from "@/lib/http/api-client-error";

const { fetchMock, pushMock } = vi.hoisted(() => ({ fetchMock: vi.fn(), pushMock: vi.fn() }));
// The page navigates with a full load (window.location.assign): the root layout has to render the signed-in shell.
const assignMock = vi.fn();
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
	beforeEach(() => {
		vi.resetAllMocks();
		Object.defineProperty(window, "location", { configurable: true, value: { ...window.location, assign: assignMock } });
	});

	it("shows a rejected challenge's API message and allows a successful retry", async () => {
		fetchMock.mockRejectedValueOnce(new ApiError(400, { error: "Invalid verification code" }));
		fetchMock.mockResolvedValueOnce({ success: true });
		render(<I18nProvider initialLocale="en"><Verify2faForm nextPath="/servers" /></I18nProvider>);
		enterCode("123456");
		expect(await screen.findByRole("alert")).toHaveTextContent("Invalid verification code");
		expect(pushMock).not.toHaveBeenCalled();
		enterCode("654321");
		await waitFor(() => expect(assignMock).toHaveBeenCalledWith("/servers"));
		expect(pushMock).not.toHaveBeenCalled();
		expect(screen.queryByRole("alert")).not.toBeInTheDocument();
	});

	it("keeps the localized network fallback for transport failures", async () => {
		fetchMock.mockRejectedValueOnce(new TypeError("Failed to fetch"));
		render(<I18nProvider initialLocale="en"><Verify2faForm nextPath="/" /></I18nProvider>);
		enterCode("123456");
		expect(await screen.findByRole("alert")).toHaveTextContent(/network/i);
		expect(screen.getByRole("button", { name: /^Verify$/i })).toBeEnabled();
	});

	it("starts over after a refused code: empty boxes, the first one focused", async () => {
		// The wrong digits stayed in the boxes and the focus was gone (the boxes are switched off while the code is
		// checked, which drops it): the next code had to be clicked into place and typed over the old one.
		fetchMock.mockRejectedValueOnce(new ApiError(400, { error: "Invalid verification code" }));
		render(<I18nProvider initialLocale="en"><Verify2faForm nextPath="/servers" /></I18nProvider>);
		enterCode("123456");
		expect(await screen.findByRole("alert")).toHaveTextContent("Invalid verification code");
		const boxes = screen.getAllByRole("textbox") as HTMLInputElement[];
		expect(boxes.map((box) => box.value)).toEqual(["", "", "", "", "", ""]);
		await waitFor(() => expect(document.activeElement).toBe(boxes[0]));
	});

	it("keeps the code when it never reached the server, so that it can be sent again", async () => {
		fetchMock.mockRejectedValueOnce(new TypeError("Failed to fetch")).mockResolvedValueOnce({ success: true });
		render(<I18nProvider initialLocale="en"><Verify2faForm nextPath="/servers" /></I18nProvider>);
		enterCode("123456");
		expect(await screen.findByRole("alert")).toHaveTextContent(/network/i);
		expect((screen.getAllByRole("textbox") as HTMLInputElement[]).map((box) => box.value).join("")).toBe("123456");
		fireEvent.click(screen.getByRole("button", { name: /^Verify$/i }));
		await waitFor(() => expect(assignMock).toHaveBeenCalledWith("/servers"));
	});

	it("takes a code pasted into any box, and what a password manager puts into one box", async () => {
		// Only the first box handled a paste; anywhere else one character went in. A code filled in as a whole
		// (one-time-code autofill) left a single digit too.
		fetchMock.mockResolvedValue({ success: true });
		const first = render(<I18nProvider initialLocale="en"><Verify2faForm nextPath="/servers" /></I18nProvider>);
		let boxes = screen.getAllByRole("textbox") as HTMLInputElement[];
		fireEvent.paste(boxes[3]!, { clipboardData: { getData: () => "123 456" } });
		await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/auth/2fa/verify-login", expect.objectContaining({ body: JSON.stringify({ code: "123456" }) })));
		first.unmount();

		fetchMock.mockClear();
		render(<I18nProvider initialLocale="en"><Verify2faForm nextPath="/servers" /></I18nProvider>);
		boxes = screen.getAllByRole("textbox") as HTMLInputElement[];
		expect(boxes[0]).toHaveAttribute("autocomplete", "one-time-code");
		fireEvent.change(boxes[0]!, { target: { value: "654321" } });
		await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/auth/2fa/verify-login", expect.objectContaining({ body: JSON.stringify({ code: "654321" }) })));
	});

	it("takes digits only, and a short paste from the box it was pasted into", () => {
		render(<I18nProvider initialLocale="en"><Verify2faForm nextPath="/servers" /></I18nProvider>);
		const boxes = screen.getAllByRole("textbox") as HTMLInputElement[];
		fireEvent.change(boxes[0]!, { target: { value: "a" } });
		expect(boxes[0]!.value).toBe("");
		fireEvent.change(boxes[0]!, { target: { value: "7" } });
		// A second key in a filled box replaces what is there.
		fireEvent.change(boxes[0]!, { target: { value: "78" } });
		expect(boxes[0]!.value).toBe("8");
		fireEvent.paste(boxes[2]!, { clipboardData: { getData: () => "45" } });
		expect(boxes.map((box) => box.value)).toEqual(["8", "", "4", "5", "", ""]);
		expect(fetchMock).not.toHaveBeenCalled();
	});
});
