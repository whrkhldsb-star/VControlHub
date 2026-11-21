import { act, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { readUserPreferencesCache, writeUserPreferencesCache } from "../browser-cache";
import { PreferenceCacheSession } from "../cache-session";
import { ACTIVE_PREFERENCES_KEY, preferencesStorageKey, PREFERENCES_KEY } from "../cache-scope";
import { useRefreshInterval } from "../use-refresh-interval";

function Dashboard({ userId }: { userId: string | null }) {
  const interval = useRefreshInterval();
  return <><PreferenceCacheSession userId={userId} /><output>{interval}</output></>;
}

function preferencesResponse(userId: string, interval: number) {
  return Response.json({ autoRefreshInterval: interval }, { headers: { "X-Preferences-User": encodeURIComponent(userId) } });
}

afterEach(() => {
  delete document.documentElement.dataset.preferencesUser;
  window.localStorage.clear();
  vi.unstubAllGlobals();
});

it("switches a polling page to the signed-in account, ignores a late response and clears the cache at logout", async () => {
  const first = Promise.withResolvers<Response>();
  const second = Promise.withResolvers<Response>();
  vi.stubGlobal("fetch", vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise));
  document.documentElement.dataset.preferencesUser = "first";
  window.localStorage.setItem(PREFERENCES_KEY, JSON.stringify({ autoRefreshInterval: 0 }));
  writeUserPreferencesCache({ autoRefreshInterval: 0 }, { notify: false });
  const view = render(<Dashboard userId="first" />);
  expect(screen.getByRole("status")).toHaveTextContent("0");
  expect(window.localStorage.getItem(PREFERENCES_KEY)).toBeNull();

  document.documentElement.dataset.preferencesUser = "second";
  view.rerender(<Dashboard userId="second" />);
  expect(screen.getByRole("status")).toHaveTextContent("30");
  expect(window.localStorage.getItem(preferencesStorageKey("first"))).toBeNull();
  await act(async () => first.resolve(preferencesResponse("first", 0)));
  expect(readUserPreferencesCache()).toBeNull();
  await act(async () => second.resolve(preferencesResponse("second", 60)));
  await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("60"));

  document.documentElement.dataset.preferencesUser = "";
  view.rerender(<Dashboard userId={null} />);
  expect(window.localStorage.getItem(preferencesStorageKey("second"))).toBeNull();
  expect(screen.getByRole("status")).toHaveTextContent("30");
});

it("ignores a response for a session changed in another tab", async () => {
  document.documentElement.dataset.preferencesUser = "old";
  const request = Promise.withResolvers<Response>();
  vi.stubGlobal("fetch", vi.fn().mockReturnValue(request.promise));
  render(<Dashboard userId="old" />);
  await act(async () => request.resolve(preferencesResponse("new", 0)));
  expect(readUserPreferencesCache()).toBeNull();
  window.localStorage.setItem(ACTIVE_PREFERENCES_KEY, preferencesStorageKey("new"));
  writeUserPreferencesCache({ autoRefreshInterval: 0 });
  expect(window.localStorage.getItem(preferencesStorageKey("old"))).toBeNull();
  expect(window.localStorage.getItem(preferencesStorageKey("new"))).toBeNull();
});
