import { render, screen } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import RemoteDesktopPage from "../[id]/remote-desktop/page";

const mocks = vi.hoisted(() => ({ find: vi.fn(), scope: vi.fn() }));
vi.mock("@/lib/auth/page-guard", () => ({ requirePagePermission: async () => ({ userId: "viewer" }) }));
vi.mock("@/lib/auth/team-scope", () => ({ serverTeamWhere: mocks.scope }));
vi.mock("@/lib/db", () => ({ prisma: { server: { findFirst: mocks.find } } }));
vi.mock("@/lib/i18n/translations", () => ({ getServerLocale: async () => "en", t: (key: string) => key }));
vi.mock("next/navigation", () => ({ notFound: () => { throw new Error("404"); } }));
vi.mock("../[id]/remote-desktop/open-remote-desktop", () => ({ OpenRemoteDesktop: () => <div>desktop</div> }));
const params = Promise.resolve({ id: "requested" });
beforeEach(() => mocks.scope.mockReturnValue({ teamId: "in-scope" }));

it("uses a single connect-scoped lookup and returns 404 when it has no match", async () => {
	mocks.find.mockResolvedValue(null);
	await expect(RemoteDesktopPage({ params })).rejects.toThrow("404");
	expect(mocks.scope).toHaveBeenCalledWith({ userId: "viewer" }, "connect");
	expect(mocks.find).toHaveBeenCalledWith(expect.objectContaining({ where: { AND: [{ id: "requested" }, { teamId: "in-scope" }] } }));
});

it.each([[false, "WINDOWS", "rdp.disabledServer"], [true, "LINUX", "rdp.windowsOnly"]])("explains an in-scope unavailable desktop", async (enabled, operatingSystem, reason) => {
	mocks.find.mockResolvedValue({ enabled, operatingSystem });
	render(await RemoteDesktopPage({ params }));
	expect(screen.getByText(String(reason))).toBeVisible();
	expect(screen.getByRole("link")).toHaveAttribute("href", "/servers");
	expect(screen.queryByText("desktop")).toBeNull();
});
