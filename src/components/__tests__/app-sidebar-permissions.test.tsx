import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

import { AppSidebar } from "../app-sidebar";
import {
	SessionGateProvider,
	gateFromRoles,
	type SessionGate,
} from "@/lib/auth/session-context";
import { I18nProvider } from "@/lib/i18n/provider";
import type { Permission } from "@/lib/auth/rbac";

vi.mock("next/navigation", () => ({
	usePathname: () => "/dashboard",
}));

vi.mock("../sign-out-button", () => ({
	SignOutButton: () => <button type="button">退出登录</button>,
}));

vi.mock("../change-password-modal", () => ({
	ChangePasswordModal: () => null,
}));

vi.mock("../notification-bell", () => ({
	NotificationBell: () => <button type="button" aria-label="通知" />,
}));

vi.mock("../theme-toggle", () => ({
	ThemeToggle: () => <button type="button" aria-label="Switch to light mode" />,
}));

vi.mock("../language-toggle", () => ({
	LanguageToggle: () => <button type="button" aria-label="语言" />,
}));

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
		<AppSidebar
			username="admin"
			declaredPermissionsByHref={declaredPermissionsByHref}
		/>,
		{ wrapper: Wrapper },
	);
}

// Sidebar permission map used across the tests below. Mirrors the shape that
// `loadSidebarDeclaredPermissions()` produces from `docs/route-catalog.json` so
// the AppSidebar filter can be tested in isolation from the catalog.
const SAMPLE_DECLARED = {
	"/dashboard": [],
	"/servers": ["server:ssh", "server:write"],
	"/files": ["share:create", "storage:delete", "storage:manage-node", "storage:write"],
	"/backups": ["backup:create", "backup:read", "backup:restore"],
	"/users": ["user:manage", "user:read"],
	"/api-tokens": ["api-token:manage"],
	"/audit": ["audit:read"],
} as const satisfies Record<string, readonly Permission[]>;

// Three pre-baked gates: a read-only session, a storage-manager session (no
// user-management), and a full admin session. Built directly so the tests are
// not coupled to the live DEFAULT_ROLE_PERMISSIONS table.
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
const ADMIN_GATE: SessionGate = gateFromRoles(["admin"]);

describe("AppSidebar permission-gated render", () => {
	it("hides main nav items whose declared permissions the session lacks", () => {
		renderWithGate(READ_ONLY_GATE, SAMPLE_DECLARED);

		// /dashboard has no declared permissions → visible to anyone authenticated.
		expect(screen.getAllByRole("link", { name: /仪表盘/ }).length).toBeGreaterThan(0);
		// /servers, /files, /backups, /users, /api-tokens all gated.
		expect(screen.queryByRole("link", { name: /VPS 管理/ })).not.toBeInTheDocument();
		expect(screen.queryByRole("link", { name: /文件管理/ })).not.toBeInTheDocument();
		expect(screen.queryByRole("link", { name: /备份迁移/ })).not.toBeInTheDocument();
		expect(screen.queryByRole("link", { name: /用户管理/ })).not.toBeInTheDocument();
	});

	it("hides the system-management section entirely when no system nav items are visible", () => {
		renderWithGate(READ_ONLY_GATE, SAMPLE_DECLARED);

		// READ_ONLY_GATE has only server:read; user / api-token / audit all gated.
		expect(screen.queryByRole("link", { name: /用户管理/ })).not.toBeInTheDocument();
		expect(screen.queryByRole("link", { name: /API Token/ })).not.toBeInTheDocument();
		expect(screen.queryByRole("link", { name: /审计日志/ })).not.toBeInTheDocument();
	});

	it("admits items via canAny — storage manager sees /files but not /users", () => {
		renderWithGate(STORAGE_GATE, SAMPLE_DECLARED);

		expect(screen.getAllByRole("link", { name: /文件管理/ }).length).toBeGreaterThan(0);
		expect(screen.queryByRole("link", { name: /用户管理/ })).not.toBeInTheDocument();
	});

	it("admits every item for admin role (no filter triggers)", () => {
		renderWithGate(ADMIN_GATE, SAMPLE_DECLARED);

		expect(screen.getAllByRole("link", { name: /仪表盘/ }).length).toBeGreaterThan(0);
		expect(screen.getAllByRole("link", { name: /VPS 管理/ }).length).toBeGreaterThan(0);
		expect(screen.getAllByRole("link", { name: /文件管理/ }).length).toBeGreaterThan(0);
		expect(screen.getAllByRole("link", { name: /备份迁移/ }).length).toBeGreaterThan(0);
		expect(screen.getAllByRole("link", { name: /用户管理/ }).length).toBeGreaterThan(0);
		expect(screen.getAllByRole("link", { name: /API 令牌/ }).length).toBeGreaterThan(0);
		expect(screen.getAllByRole("link", { name: /审计日志/ }).length).toBeGreaterThan(0);
	});

	it("hides every permission-gated item when the provider is missing (fail-safe default)", () => {
		function Wrapper({ children }: { children: ReactNode }) {
			return <I18nProvider initialLocale="zh">{children}</I18nProvider>;
		}
		render(
			<AppSidebar username="admin" declaredPermissionsByHref={SAMPLE_DECLARED} />,
			{ wrapper: Wrapper },
		);

		// Dashboard has no declared perms → still visible.
		expect(screen.getAllByRole("link", { name: /仪表盘/ }).length).toBeGreaterThan(0);
		// Every permission-gated item is hidden.
		expect(screen.queryByRole("link", { name: /VPS 管理/ })).not.toBeInTheDocument();
		expect(screen.queryByRole("link", { name: /备份迁移/ })).not.toBeInTheDocument();
	});
});
