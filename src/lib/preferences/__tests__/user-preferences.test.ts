import { describe, expect, it } from "vitest";

import {
  DASHBOARD_WIDGET_IDS,
  getAvailableDefaultPageOptions,
  normalizeUserPreferences,
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

/**
 * A saved layout used to be the list of visible widgets only, so a widget added to the dashboard later
 * counted as hidden for everyone who had ever saved a layout. A layout now records the widgets it knew.
 */
describe("dashboard layout", () => {
  it("shows a widget added after the layout was saved, at the end", () => {
    const prefs = normalizeUserPreferences({
      dashboardWidgets: ["audit-log"],
      dashboardWidgetsKnown: ["server-status", "quick-links", "audit-log"],
    });
    expect(prefs.dashboardWidgets).toEqual(["audit-log", "analytics"]);
    expect(prefs.dashboardWidgetsKnown).toEqual([...DASHBOARD_WIDGET_IDS]);
  });

  it("keeps hidden what a layout from before the change left out", () => {
    expect(normalizeUserPreferences({ dashboardWidgets: ["quick-links", "server-status"] }).dashboardWidgets).toEqual(["quick-links", "server-status"]);
  });

  it("hides what a new selection leaves out, instead of taking it for a new widget", () => {
    const saved = normalizeUserPreferences({ dashboardWidgets: [...DASHBOARD_WIDGET_IDS] });
    expect(normalizeUserPreferences({ ...saved, dashboardWidgets: ["server-status"] }).dashboardWidgets).toEqual(["server-status"]);
    expect(normalizeUserPreferences({ ...saved, dashboardWidgets: [] }).dashboardWidgets).toEqual([]);
  });

  it("shows everything when nothing was saved", () => {
    expect(normalizeUserPreferences({}).dashboardWidgets).toEqual([...DASHBOARD_WIDGET_IDS]);
    expect(normalizeUserPreferences({ dashboardWidgets: "analytics" }).dashboardWidgets).toEqual([...DASHBOARD_WIDGET_IDS]);
  });
});
