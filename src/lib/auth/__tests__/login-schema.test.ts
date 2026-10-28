import { describe, expect, it } from "vitest";

import { loginSchema } from "../schema";
import { createUserSchema } from "@/lib/user/schema";

describe("loginSchema username range", () => {
  const login = (username: string) => loginSchema.safeParse({ username, password: "long-enough-pass" }).success;

  it("accepts every length an account can be created with", () => {
    for (const length of [2, 3, 32, 33, 40]) {
      expect(login("a".repeat(length)), `login length ${length}`).toBe(true);
      expect(
        createUserSchema.safeParse({ username: "a".repeat(length), password: "long-enough-pass", account: { type: "admin" } }).success,
        `create length ${length}`,
      ).toBe(true);
    }
  });

  it("still refuses names no account can have", () => {
    expect(login("a")).toBe(false);
    expect(login("a".repeat(41))).toBe(false);
  });
});
