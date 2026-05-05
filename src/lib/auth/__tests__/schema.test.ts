import { describe, expect, it } from "vitest";

import { loginSchema } from "@/lib/auth/schema";

describe("loginSchema", () => {
  it("accepts a valid username and password", () => {
    const result = loginSchema.parse({
      username: "admin",
      password: "19970103",
    });

    expect(result.username).toBe("admin");
  });

  it("rejects passwords that are too short", () => {
    expect(() =>
      loginSchema.parse({
        username: "admin",
        password: "123",
      }),
    ).toThrow(/至少 8 位/);
  });
});
