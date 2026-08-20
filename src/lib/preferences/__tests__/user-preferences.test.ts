import { describe, expect, it } from "vitest";

import {
  getAvailableDefaultPageOptions,
  normalizeUserPreferencesForAllowedDefaultPages,
  normalizeUserPreferencesForRoles,
} from "../user-preferences";

describe("role-aware default page preferences", () => {
  it("keeps only routes granted by the current role", () => {
    expect(getAvailableDefaultPageOptions((permission) => permission === "server:read")).toEqual([
      "/",
      "/servers",
    ]);
  });

  it("falls back to the dashboard after permissions are removed", () => {
    expect(normalizeUserPreferencesForRoles({ defaultPage: "/docker" }, ["viewer"])).toMatchObject({
      defaultPage: "/",
    });
    expect(normalizeUserPreferencesForRoles({ defaultPage: "/files" }, ["viewer"])).toMatchObject({
      defaultPage: "/files",
    });
  });

  it("uses the dashboard when a client receives a saved page outside its allowed options", () => {
    expect(
      normalizeUserPreferencesForAllowedDefaultPages(
        { defaultPage: "/ai" },
        ["/", "/servers"],
      ),
    ).toMatchObject({ defaultPage: "/" });
  });
});
