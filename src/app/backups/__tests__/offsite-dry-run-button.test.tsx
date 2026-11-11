import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { renderWithI18n as render } from "@/lib/i18n/__tests__/test-helpers";

const mocks = vi.hoisted(() => ({ fetch: vi.fn() }));
vi.mock("@/lib/auth/csrf-client", () => ({ csrfFetch: mocks.fetch }));

import { OffsiteDryRunButton } from "../offsite-dry-run-button";

function answer(status: number, body: unknown) {
	return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

describe("OffsiteDryRunButton", () => {
	beforeEach(() => {
		mocks.fetch.mockReset();
	});

	it("reports a successful probe and a switched-off target", async () => {
		const user = userEvent.setup();
		mocks.fetch.mockResolvedValueOnce(answer(200, { ok: true, probeKey: "probe/1", latencyMs: 42 }));
		render(<OffsiteDryRunButton />);
		await user.click(screen.getByRole("button"));
		expect(await screen.findByText(/42/)).toBeInTheDocument();
		expect(mocks.fetch).toHaveBeenCalledWith("/api/backups/offsite/dry-run", expect.objectContaining({ method: "POST" }));

		mocks.fetch.mockResolvedValueOnce(answer(422, { ok: false, reason: "offsite_disabled" }));
		await user.click(screen.getByRole("button"));
		expect(await screen.findByText(/未启用|尚未启用|未开启/)).toBeInTheDocument();
	});

	// It read "HTTP 403" (or the whole body of an unexpected 422) where the server had said why.
	it("says why the request was refused in the server's words", async () => {
		const user = userEvent.setup();
		mocks.fetch.mockResolvedValueOnce(answer(403, { error: "缺少权限：backup:create", message: "缺少权限：backup:create", code: "FORBIDDEN" }));
		render(<OffsiteDryRunButton />);
		await user.click(screen.getByRole("button"));
		const notice = await screen.findByText(/缺少权限：backup:create/);
		expect(notice).not.toHaveTextContent("HTTP 403");

		// A body with nothing readable: the status is what is left to show.
		mocks.fetch.mockResolvedValueOnce(new Response("upstream timed out", { status: 504 }));
		await user.click(screen.getByRole("button"));
		expect(await screen.findByText(/HTTP 504/)).toBeInTheDocument();

		mocks.fetch.mockResolvedValueOnce(answer(422, { ok: false, reason: "something_new", message: "探测对象无法写入" }));
		await user.click(screen.getByRole("button"));
		const unexpected = await screen.findByText(/探测对象无法写入/);
		expect(unexpected).not.toHaveTextContent("{");
	});
});
