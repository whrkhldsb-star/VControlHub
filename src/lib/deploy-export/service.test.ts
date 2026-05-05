import { describe, expect, it, vi } from "vitest";
const { mockPrisma } = vi.hoisted(() => ({ mockPrisma: { deploymentExport: { create: vi.fn() } } }));
vi.mock("@/lib/db", () => ({ prisma: mockPrisma }));
const { buildPortableDeploymentPackage } = await import("./service");
describe("deployment export service", () => {
  it("builds portable templates with placeholders and no secrets", () => {
    const pkg = buildPortableDeploymentPackage({ domain: "whrkhldsb.qzz.io" });
    const text = JSON.stringify(pkg.files);
    expect(text).toContain("REPLACE_WITH_DATABASE_URL");
    expect(text).toContain("AUTH_SESSION_SECRET");
    expect(text).toContain("REPLACE_WITH_AUTH_SESSION_SECRET");
    expect(text).toContain("whrkhldsb-next.service");
    expect(text).toContain("Caddyfile");
    expect(text).not.toMatch(/postgres(?:ql)?:\/\/[^\s\"']+:[^\s\"']+@/i);
    expect(text).not.toMatch(/BEGIN (?:OPENSSH|RSA|EC|DSA) PRIVATE KEY/);
    for (const flag of pkg.manifest.dangerousEnvFlags) expect(text).toContain(`${flag}=\\\"false\\\"`);
  });
  it("rejects unsafe domain and app name before generating executable templates", () => {
    expect(() => buildPortableDeploymentPackage({ domain: "good.com\nrespond hacked" })).toThrow(/域名/);
    expect(() => buildPortableDeploymentPackage({ appName: "bad;rm-rf" })).toThrow(/应用名称/);
  });
});
