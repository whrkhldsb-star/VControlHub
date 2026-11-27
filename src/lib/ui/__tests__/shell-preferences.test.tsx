import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PreferenceCacheSession } from "@/lib/preferences/cache-session";
import { ACTIVE_PREFERENCES_KEY, PREFERENCES_KEY, preferencesStorageKey } from "@/lib/preferences/cache-scope";
import { useRefreshInterval } from "@/lib/preferences/use-refresh-interval";
import {
  clearShellPreferences,
  recordRecentPage,
  SHELL_PREFERENCE_KEYS,
  useNavPins,
  useRecentPages,
} from "../shell-preferences";

function Session({ userId }: { userId: string | null }) {
  const { pins } = useNavPins();
  const recent = useRecentPages();
  const interval = useRefreshInterval();
  return (
    <>
      <PreferenceCacheSession userId={userId} />
      <output>
        {pins.join(",")}|{recent.join(",")}|{interval}
      </output>
    </>
  );
}

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  delete document.documentElement.dataset.preferencesUser;
  window.localStorage.clear();
  vi.unstubAllGlobals();
});

describe("shell preferences clear on account change (D-04)", () => {
  it("exports every shell preference localStorage key", () => {
    expect(SHELL_PREFERENCE_KEYS).toEqual(["vch:nav-pins", "vch:nav-groups", "vch:recent-pages"]);
  });

  it("clearShellPreferences removes the keys and resets the in-memory snapshot cache", () => {
    window.localStorage.setItem("vch:nav-pins", JSON.stringify(["/servers"]));
    window.localStorage.setItem("vch:nav-groups", JSON.stringify({ main: true }));
    window.localStorage.setItem("vch:recent-pages", JSON.stringify(["/dashboard"]));
    // Prime the snapshot cache by rendering a hook consumer once.
    const view = render(<Session userId={null} />);
    expect(screen.getByRole("status")).toHaveTextContent("/servers|/dashboard");

    act(() => clearShellPreferences());
    for (const key of SHELL_PREFERENCE_KEYS) expect(window.localStorage.getItem(key)).toBeNull();
    // The snapshot cache was reset: the same mounted component re-read empty lists.
    expect(screen.getByRole("status")).toHaveTextContent("|");
    view.unmount();
  });

  it("an account switch or sign-out clears the previous user's shell preferences", async () => {
    document.documentElement.dataset.preferencesUser = "first";
    window.localStorage.setItem(ACTIVE_PREFERENCES_KEY, preferencesStorageKey("first"));
    // The previous user leaves shell preferences behind.
    window.localStorage.setItem("vch:nav-pins", JSON.stringify(["/files"]));
    recordRecentPage("/tickets");
    expect(window.localStorage.getItem("vch:recent-pages")).toContain("/tickets");

    vi.stubGlobal("fetch", vi.fn().mockReturnValue(new Promise(() => {})));
    const view = render(<Session userId="first" />);
    expect(screen.getByRole("status")).toHaveTextContent("/files|/tickets");

    // Sign out: the session component must drop the shell preferences.
    document.documentElement.dataset.preferencesUser = "";
    await act(async () => view.rerender(<Session userId={null} />));
    for (const key of SHELL_PREFERENCE_KEYS) expect(window.localStorage.getItem(key)).toBeNull();
    // The previous user's preferences cache key is gone too (existing behaviour).
    expect(window.localStorage.getItem(preferencesStorageKey("first"))).toBeNull();
    expect(window.localStorage.getItem(ACTIVE_PREFERENCES_KEY)).toBe(PREFERENCES_KEY + ":");
    view.unmount();
  });

  it("leaves shell preferences alone while the same user stays signed in", async () => {
    document.documentElement.dataset.preferencesUser = "only";
    window.localStorage.setItem(ACTIVE_PREFERENCES_KEY, preferencesStorageKey("only"));
    window.localStorage.setItem("vch:nav-pins", JSON.stringify(["/settings"]));
    vi.stubGlobal("fetch", vi.fn().mockReturnValue(new Promise(() => {})));
    const view = render(<Session userId="only" />);
    expect(window.localStorage.getItem("vch:nav-pins")).toContain("/settings");
    await act(async () => view.rerender(<Session userId="only" />));
    expect(window.localStorage.getItem("vch:nav-pins")).toContain("/settings");
    view.unmount();
  });
});
