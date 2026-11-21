import { Children, isValidElement, type ReactNode } from "react";
import { expect, it, vi } from "vitest";
import { getAppMetadataTitle, getAppName } from "@/lib/branding";
import { AppSidebar } from "@/components/app-sidebar";
import { AppTopbar } from "@/components/app-topbar";
import RootLayout, { generateMetadata } from "@/app/layout";
import { getPlatformDefaults } from "@/lib/settings/platform-defaults";

vi.mock("next/font/google", () => ({
  Geist: () => ({ variable: "sans" }), Geist_Mono: () => ({ variable: "mono" }),
}));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => ({ value: "signed-in" }) }), headers: async () => ({ get: () => null }),
}));
vi.mock("@/lib/auth/server-session", () => ({
  getCurrentSession: async () => ({ userId: "user", username: "user", roles: ["admin"], currentTeamId: null }),
}));
vi.mock("@/lib/settings/platform-defaults", () => ({ getPlatformDefaults: vi.fn() }));
vi.mock("@/lib/quick-service/service", () => ({ listQuickServices: async () => [] }));

function findInLayout(node: ReactNode, type: unknown): Record<string, unknown> | undefined {
  if (!isValidElement<{ children?: ReactNode }>(node)) return;
  if (node.type === type) return node.props;
  for (const child of Children.toArray(node.props.children)) {
    const result = findInLayout(child, type);
    if (result) return result;
  }
}

it("uses the saved name for metadata and both navigation surfaces, with safe logo and deployment fallbacks", async () => {
  vi.mocked(getPlatformDefaults).mockResolvedValue({ locale: "en", theme: "dark", name: "Operations", logo: "/brand.png" });
  expect(await generateMetadata()).toMatchObject({ title: "Operations", icons: { icon: "/brand.png" } });
  const layout = await RootLayout({ children: null });
  expect(findInLayout(layout, AppSidebar)).toMatchObject({ appName: "Operations", username: "user" });
  expect(findInLayout(layout, AppTopbar)).toMatchObject({ appName: "Operations" });
  expect(findInLayout(layout, "body")?.style).toMatchObject({ "--platform-logo": 'url("/brand.png")' });
  vi.mocked(getPlatformDefaults).mockResolvedValue({ locale: "en", theme: "dark" });
  expect((await generateMetadata()).title).toBe(getAppMetadataTitle());
  const fallback = await RootLayout({ children: null });
  expect(findInLayout(fallback, AppSidebar)?.appName).toBe(getAppName());
  expect(findInLayout(fallback, AppTopbar)?.appName).toBe(getAppName());
  expect(findInLayout(fallback, "body")?.style).toBeUndefined();
});
