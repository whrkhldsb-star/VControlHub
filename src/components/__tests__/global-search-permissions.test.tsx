import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

import { GlobalSearch } from "../global-search";
import {
	SessionGateProvider,
	type SessionGate,
} from "@/lib/auth/session-context";
import { I18nProvider } from "@/lib/i18n/provider";
import type { Permission } from "@/lib/auth/rbac";

const pushMock = vi.fn();

vi.mock("next/navigation", () => ({
	useRouter: () => ({ push: pushMock }),
}));

function openSearchOverlay() {
	act(() => {
		window.dispatchEvent(new KeyboardEvent("keydown", { key: "k", ctrlKey: true, bubbles: true }));
	});
}

function renderWithGate(
	gate: SessionGate,
	declaredPermissionsByHref: Record<string, readonly Permission[]> = {},
) {
	function Wrapper({ children }: { children: ReactNode }) {
		return (
			<I18nProvider initialLocale="zh">
				<SessionGateProvider value={gate}>{children}</SessionGateProvider>
			</I18nProvider>
		);
	}
	return render(
		<GlobalSearch declaredPermissionsByHref={declaredPermissionsByHref} />,
		{ wrapper: Wrapper },
	);
}

const SAMPLE_DECLARED = {
	"/dashboard": [],
	"/servers": ["server:ssh", "server:write"],
	"/files": ["storage:read", "storage:write", "storage:manage-node", "share:create"],
	"/backups": ["backup:create", "backup:read", "backup:restore"],
	"/users": ["user:manage"],
	"/audit": ["audit:read"],
} as const satisfies Record<string, readonly Permission[]>;

// Two pre-baked gates: a read-only session and a storage-manager session. The
// `users` href declares `["user:manage"]` only — so neither of these gates
// (nor the empty gate) should see it.
const READ_ONLY_GATE: SessionGate = {
	roles: [],
	permissions: ["server:read"],
	authenticated: true,
};
const STORAGE_GATE: SessionGate = {
	roles: [],
	permissions: ["storage:read", "storage:write", "storage:manage-node", "share:create"],
	authenticated: true,
};

describe("GlobalSearch permission-gated filter", () => {
	it("hides search results for hrefs the session lacks permission for", async () => {
		const user = userEvent.setup();
		pushMock.mockClear();
		renderWithGate(READ_ONLY_GATE, SAMPLE_DECLARED);

		openSearchOverlay();
		const input = await screen.findByPlaceholderText("搜索页面、操作...");
		await user.type(input, "用户管理");

		// "/users" declared as ["user:manage"]; READ_ONLY has server:read only.
		expect(screen.queryByRole("option", { name: /用户管理/ })).not.toBeInTheDocument();
	});

	it("admits items with no declared permissions to any authenticated session", async () => {
		const user = userEvent.setup();
		pushMock.mockClear();
		renderWithGate(READ_ONLY_GATE, SAMPLE_DECLARED);

		openSearchOverlay();
		const input = await screen.findByPlaceholderText("搜索页面、操作...");
		await user.type(input, "仪表盘");

		expect(await screen.findByRole("option", { name: /仪表盘/ })).toBeInTheDocument();
	});

	it("admits items when the session holds any one of the declared permissions", async () => {
		const user = userEvent.setup();
		pushMock.mockClear();
		renderWithGate(STORAGE_GATE, SAMPLE_DECLARED);

		openSearchOverlay();
		const input = await screen.findByPlaceholderText("搜索页面、操作...");
		await user.type(input, "文件");

		expect(await screen.findByRole("option", { name: /文件管理/ })).toBeInTheDocument();
	});

	it("hides every permission-gated option when no provider is mounted (fail-safe)", async () => {
		const user = userEvent.setup();
		pushMock.mockClear();
		function Wrapper({ children }: { children: ReactNode }) {
			return <I18nProvider initialLocale="zh">{children}</I18nProvider>;
		}
		render(<GlobalSearch declaredPermissionsByHref={SAMPLE_DECLARED} />, { wrapper: Wrapper });

		openSearchOverlay();
		const input = await screen.findByPlaceholderText("搜索页面、操作...");
		await user.type(input, "用户管理");

		expect(screen.queryByRole("option", { name: /用户管理/ })).not.toBeInTheDocument();
	});
});
