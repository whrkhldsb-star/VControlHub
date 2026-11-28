import { screen } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { renderWithI18n } from "@/lib/i18n/__tests__/test-helpers";
import CommandsPage from "../page";

const mocks = vi.hoisted(() => ({ perms: new Set<string>(), detail: vi.fn(), servers: vi.fn() }));
vi.mock("@/lib/auth/page-guard", () => ({ requirePagePermission: () => ({ userId: "me" }) }));
vi.mock("@/lib/auth/authorization", () => ({ sessionHasPermission: (_: unknown, permission: string) => mocks.perms.has(permission) }));
vi.mock("@/lib/db", () => ({ prisma: { server: { findMany: mocks.servers } } }));
vi.mock("@/lib/auth/team-scope", () => ({ serverTeamWhere: () => ({}) }));
vi.mock("@/lib/command/service", () => ({ getCommandRequestDetailForViewer: mocks.detail }));
vi.mock("@/lib/snippet/service", () => ({ getSnippet: vi.fn(), snippetViewer: vi.fn() }));
vi.mock("@/lib/i18n/translations", async importOriginal => ({ ...await importOriginal<object>(), getServerLocale: () => "en" }));
beforeEach(() => { vi.clearAllMocks(); mocks.perms.clear(); mocks.servers.mockResolvedValue([]); });
it.each(["hidden", "missing", "no command:read"])("refuses rerun prefill for %s", async condition => {
	mocks.perms.add("server:read"); if (condition !== "no command:read") mocks.perms.add("command:read");
	mocks.detail.mockResolvedValue(condition === "missing" ? null : { commandHidden: true, command: "hidden sentinel", title: "secret title" });
	renderWithI18n(await CommandsPage({ searchParams: Promise.resolve({ fromRequestId: "original" }) }), { locale: "en" });
	expect(screen.getByText(condition === "hidden" ? /body is hidden/ : /original request is unavailable/)).toBeVisible();
	expect(screen.getByLabelText("Command")).toHaveValue(""); expect(screen.queryByDisplayValue("secret title")).toBeNull();
	expect(mocks.detail).toHaveBeenCalledTimes(condition === "no command:read" ? 0 : 1);
});
it("explains missing server:read before querying inventory or history", async () => {
	renderWithI18n(await CommandsPage({ searchParams: Promise.resolve({ fromRequestId: "original" }) }), { locale: "en" });
	expect(screen.getByText(/requires the server:read permission/)).toBeVisible();
	expect(mocks.servers).not.toHaveBeenCalled(); expect(mocks.detail).not.toHaveBeenCalled();
});
