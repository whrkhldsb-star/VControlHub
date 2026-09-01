import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Tests for the share access-log panel.
 *
 * Access logs record who opened a share link, so the panel is a small audit
 * surface: a load failure has to be visible rather than rendering as "nobody has
 * opened this link", which would read as a reassuring answer to a security
 * question. The share id also goes into a path segment and is therefore
 * percent-encoded.
 */
const mocks = vi.hoisted(() => ({ csrfFetch: vi.fn() }));

vi.mock("@/lib/auth/csrf-client", () => ({ csrfFetch: mocks.csrfFetch }));
const i18n = {
	t: (key: string, vars?: Record<string, string | number>) =>
		vars ? `${key}:${Object.values(vars).join(",")}` : key,
	locale: "zh" as const,
	setLocale: () => {},
};
vi.mock("@/lib/i18n/use-locale", () => ({ useI18n: () => i18n }));

import { ShareAccessLogsButton } from "../share-access-logs";

const log = {
	id: "al_1",
	action: "VIEW",
	ip: "203.0.113.9",
	userAgent: "Mozilla/5.0",
	accessedAt: "2026-08-31T10:00:00.000Z",
};

/** The panel is collapsed until its button is clicked, which is what fetches. */
function openPanel(shareId = "share_1") {
	render(<ShareAccessLogsButton shareId={shareId} />);
	fireEvent.click(screen.getByRole("button"));
}

describe("ShareAccessLogs", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.csrfFetch.mockReset();
		mocks.csrfFetch.mockResolvedValue({ logs: [log] });
	});

	it("percent-encodes the share id in the request path", async () => {
		openPanel("share/1 odd");
		await waitFor(() =>
			expect(mocks.csrfFetch).toHaveBeenCalledWith("/api/shares/share%2F1%20odd/access-logs"),
		);
	});

	it("renders the returned entries", async () => {
		openPanel();
		await waitFor(() => expect(screen.getByText(/203\.0\.113\.9/)).toBeInTheDocument());
	});

	it("shows a failure rather than an empty list, which would read as 'never accessed'", async () => {
		// This panel answers a security question; a silent failure is a wrong answer.
		mocks.csrfFetch.mockRejectedValue(new Error("audit store unavailable"));
		openPanel();
		await waitFor(() =>
			expect(screen.getByText(/audit store unavailable/)).toBeInTheDocument(),
		);
	});

	it("treats a payload with no logs array as empty rather than crashing", async () => {
		mocks.csrfFetch.mockResolvedValue({});
		openPanel();
		await waitFor(() => expect(mocks.csrfFetch).toHaveBeenCalled());
		expect(screen.queryByText(/203\.0\.113\.9/)).toBeNull();
	});
});
