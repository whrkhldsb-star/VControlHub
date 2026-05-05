import { describe, expect, it } from "vitest";

import {
  ADMIN_BOOTSTRAP,
  getInitialAdminPassword,
  getInitialAdminProfile,
} from "@/lib/auth/bootstrap";
import { hashPassword, verifyPassword } from "@/lib/auth/password";

describe("auth bootstrap", () => {
  it("keeps the initial admin username stable and requires password rotation", () => {
    const profile = getInitialAdminProfile();

    expect(profile.username).toBe("admin");
    expect(profile.mustChangePassword).toBe(true);
    expect(profile.status).toBe("PENDING_PASSWORD_RESET");
    expect(ADMIN_BOOTSTRAP.displayName).toContain("Admin");
  });

  it("hashes and verifies the initial password", async () => {
    const hash = await hashPassword(getInitialAdminPassword());

    expect(hash).not.toBe(getInitialAdminPassword());
    await expect(verifyPassword(getInitialAdminPassword(), hash)).resolves.toBe(true);
    await expect(verifyPassword("wrong-password", hash)).resolves.toBe(false);
  });
});
