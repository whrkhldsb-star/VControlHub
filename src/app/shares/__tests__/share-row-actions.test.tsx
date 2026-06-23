import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ShareRowActions } from "../share-row-actions";
import { csrfFetch } from "@/lib/auth/csrf-client";

const refresh = vi.fn();

vi.mock("next/navigation", () => ({
	useRouter: () => ({ refresh }),
}));

vi.mock("@/lib/auth/csrf-client", () => ({ csrfFetch: vi.fn() }));

const mockedFetch = vi.mocked(csrfFetch);

describe("ShareRowActions", () => {
	beforeEach(() => {
		vi.restoreAllMocks();
		mockedFetch.mockReset();
		refresh.mockReset();
	});

	it("opens an inline confirmation before calling the delete API", async () => {
		const user = userEvent.setup();
		mockedFetch.mockResolvedValueOnce(undefined);

		render(<ShareRowActions id="share_1" revoked={false} />);

		await user.click(screen.getByRole("button", { name: "撤销" }));

		expect(screen.getByText("撤销后该分享链接将立即失效且无法恢复。")).toBeInTheDocument();
		expect(screen.getByRole("button", { name: "确认撤销" })).toBeInTheDocument();
		expect(mockedFetch).not.toHaveBeenCalled();

		await user.click(screen.getByRole("button", { name: "确认撤销" }));

		await waitFor(() =>
			expect(mockedFetch).toHaveBeenCalledWith("/api/share-links?id=share_1", { method: "DELETE" }),
		);
		expect(refresh).toHaveBeenCalled();
	});

	it("does not call the delete API when the inline confirmation is cancelled", async () => {
		const user = userEvent.setup();

		render(<ShareRowActions id="share_1" revoked={false} />);

		await user.click(screen.getByRole("button", { name: "撤销" }));
		await user.click(screen.getByRole("button", { name: "取消" }));

		expect(screen.queryByRole("button", { name: "确认撤销" })).not.toBeInTheDocument();
		expect(mockedFetch).not.toHaveBeenCalled();
		expect(refresh).not.toHaveBeenCalled();
	});

	it("renders the revoked label and hides the revoke button when already revoked", () => {
		render(<ShareRowActions id="share_1" revoked={true} />);

		expect(screen.getByText("已撤销")).toBeInTheDocument();
		expect(screen.queryByRole("button", { name: "撤销" })).not.toBeInTheDocument();
	});

	describe("touch targets (TR-022 R19.B mobile)", () => {
		function mockHeightsBySelector(measurements: Record<string, number>) {
			// jsdom reports getBoundingClientRect as 0x0; install a minimal stub
			// that returns the requested height for buttons whose className includes
			// the test selector. Sufficient for asserting that min-h-11 produced
			// at least 44px of computed height. Same pattern as R17/R18/R19.A.
			const original = Element.prototype.getBoundingClientRect;
			Element.prototype.getBoundingClientRect = function () {
				const className = (this.getAttribute("class") ?? "") as string;
				for (const [selector, height] of Object.entries(measurements)) {
					if (className.includes(selector)) {
						return { x: 0, y: 0, top: 0, left: 0, right: 0, bottom: 0, width: 100, height, toJSON: () => ({}) } as DOMRect;
					}
				}
				return original.call(this);
			};
			return () => {
				Element.prototype.getBoundingClientRect = original;
			};
		}

		it("renders the revoke text-only button with at least 44px height/width", () => {
			const restore = mockHeightsBySelector({ "min-h-11": 44 });
			try {
				render(<ShareRowActions id="share_1" revoked={false} />);
				const btn = screen.getByRole("button", { name: "撤销" });
				expect(btn.getBoundingClientRect().height).toBeGreaterThanOrEqual(44);
				expect(btn.getBoundingClientRect().width).toBeGreaterThanOrEqual(44);
			} finally {
				restore();
			}
		});
	});
});
