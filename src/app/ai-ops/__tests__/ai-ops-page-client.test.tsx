/**
 * TR-030 / 56 multi-tenant (Tick 3): conditional render audit.
 *
 * Asserts that the management surfaces in `AiOpsPageClient` (trigger
 * scan button, mode select / providerId input in settings, per-action
 * execute buttons) are fully removed when `canManage` is false, instead
 * of being rendered with `disabled={!canManage || ...}`.
 *
 * This is the "no disabled placeholder" rule from the user decision
 * 2026-06-16: hide UI entirely when the user lacks permission so there
 * is no half-render, no placeholder, and no leaky click target.
 */
import { screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AiOpsLogRecord, AiOpsMode, AiOpsStatus } from "@/lib/ai/ops/types";
import type { AiOpsSummary } from "@/lib/ai/ops/service";
import { renderWithI18n as render } from "@/lib/i18n/__tests__/test-helpers";

import { AiOpsPageClient } from "../ai-ops-page-client";

const initialSummary: AiOpsSummary = {
	total: 0,
	byStatus: {
		ok: 0,
		error: 0,
		warning: 0,
		skipped: 0,
		running: 0,
	} satisfies Record<AiOpsStatus, number>,
	byMode: {
		recommendation: 0,
		autonomous: 0,
	} satisfies Record<AiOpsMode, number>,
	lastScanAt: null,
	lastErrorAt: null,
};

const initialSettings = {
	mode: "recommendation" as const,
	providerId: null,
	scanScheduleHour: 2,
};

const initialLogs: AiOpsLogRecord[] = [];

const csrfFetch = vi.fn();

vi.mock("@/lib/auth/csrf-client", () => ({
	csrfFetch: (...args: unknown[]) => csrfFetch(...args),
}));

// P-NEW-CA: ai-ops-page-client uses useToast() for scan/action feedback.
// We don't exercise the toast UI in this audit — just suppress the
// "useToast must be used within <ToastProvider>" runtime error by providing
// a no-op provider that yields the same shape.
vi.mock("@/components/toast-provider", () => ({
	useToast: () => ({
		toasts: [],
		addToast: vi.fn(),
		removeToast: vi.fn(),
	}),
	ToastProvider: ({ children }: { children: React.ReactNode }) => children,
}));

describe("AiOpsPageClient conditional render audit", () => {
	beforeEach(() => {
		csrfFetch.mockReset();
	});
	afterEach(() => {
		vi.clearAllMocks();
	});

	it("hides the trigger scan button when canManage is false", async () => {
		render(
			<AiOpsPageClient
				initialSummary={initialSummary}
				initialLogs={initialLogs}
				initialSettings={initialSettings}
				canManage={false}
				canAutonomous={false}
			/>,
		);

		await waitFor(() => {
			expect(
				screen.queryByRole("button", { name: /立即扫描|触发扫描/i }),
			).toBeNull();
		});
	});

	it("renders the trigger scan button when canManage is true", async () => {
		render(
			<AiOpsPageClient
				initialSummary={initialSummary}
				initialLogs={initialLogs}
				initialSettings={initialSettings}
				canManage={true}
				canAutonomous={false}
			/>,
		);

		expect(
			await screen.findByRole("button", { name: /立即扫描|触发扫描/i }),
		).toBeInTheDocument();
	});

	it("shows the settings mode select only when canManage is true", async () => {
		// The settings card is wrapped in `{canManage && (...)}`, so when
		// canManage is false the entire <select> is absent from the DOM.
		// We probe for the <select> element directly rather than the option
		// text (which is localized) so the assertion stays locale-agnostic.
		const { rerender } = render(
			<AiOpsPageClient
				initialSummary={initialSummary}
				initialLogs={initialLogs}
				initialSettings={initialSettings}
				canManage={false}
				canAutonomous={false}
			/>,
		);

		// Three <select> elements are part of the filter toolbar (mode / status
		// / triggerType). The settings card's mode <select> is only present
		// when canManage is true.
		expect(document.querySelectorAll("select").length).toBe(3);

		rerender(
			<AiOpsPageClient
				initialSummary={initialSummary}
				initialLogs={initialLogs}
				initialSettings={initialSettings}
				canManage={true}
				canAutonomous={false}
			/>,
		);

		// After enabling canManage, the settings card adds its own <select>.
		await waitFor(() => {
			expect(document.querySelectorAll("select").length).toBe(4);
		});
	});

	it("hides the per-action execute buttons when canManage is false", async () => {
		const logsWithAction: AiOpsLogRecord[] = [
			{
				id: "log-1",
				createdAt: "2026-06-18T00:00:00.000Z",
				updatedAt: "2026-06-18T00:00:00.000Z",
				mode: "recommendation",
				triggerType: "manual",
				status: "ok",
				findings: [],
				actions: [
					{
						id: "a-1",
						action: "noop",
						risk: "low",
						requiresApproval: false,
						reason: "smoke",
					},
				],
				notes: null,
				errorMessage: null,
				providerId: null,
				startedAt: null,
				completedAt: null,
				durationMs: 10,
				triggeredById: null,
			},
		];

		render(
			<AiOpsPageClient
				initialSummary={initialSummary}
				initialLogs={logsWithAction}
				initialSettings={initialSettings}
				canManage={false}
				canAutonomous={false}
			/>,
		);

		// No execute / approve buttons rendered for the read-only viewer.
		// The detail panel is identified via `aria-label="ai-ops-detail"`.
		const detail = await screen.findByLabelText("ai-ops-detail");
		await waitFor(() => {
			expect(within(detail).queryByRole("button", { name: /^执行$/i })).toBeNull();
			expect(within(detail).queryByRole("button", { name: /^批准$/i })).toBeNull();
			expect(
				within(detail).queryByRole("button", { name: /强制自主/i }),
			).toBeNull();
		});
	});

	it("renders the per-action execute button when canManage is true", async () => {
		const logsWithAction: AiOpsLogRecord[] = [
			{
				id: "log-1",
				createdAt: "2026-06-18T00:00:00.000Z",
				updatedAt: "2026-06-18T00:00:00.000Z",
				mode: "recommendation",
				triggerType: "manual",
				status: "ok",
				findings: [],
				actions: [
					{
						id: "a-1",
						action: "noop",
						risk: "low",
						requiresApproval: false,
						reason: "smoke",
					},
				],
				notes: null,
				errorMessage: null,
				providerId: null,
				startedAt: null,
				completedAt: null,
				durationMs: 10,
				triggeredById: null,
			},
		];

		render(
			<AiOpsPageClient
				initialSummary={initialSummary}
				initialLogs={logsWithAction}
				initialSettings={initialSettings}
				canManage={true}
				canAutonomous={false}
			/>,
		);

		// Scope the lookup to the per-action panel — the save settings button
		// also renders with text "执行" so a document-wide findByRole would
		// match multiple elements.
		const detail = await screen.findByLabelText("ai-ops-detail");
		expect(
			await within(detail).findByRole("button", { name: /^执行$/i }),
		).toBeInTheDocument();
	});
});
