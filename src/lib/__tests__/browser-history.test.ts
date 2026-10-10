import { afterEach, expect, it, vi } from "vitest";
import { replaceBrowserUrl } from "../browser-history";

afterEach(() => {
	vi.restoreAllMocks();
	window.history.replaceState(null, "", "/");
});

it("drops Next's internal markers so the router adopts the new URL, keeping other state", () => {
	window.history.replaceState({ __NA: true, _N: 1, marker: "router" }, "", "/settings");
	const spy = vi.spyOn(window.history, "replaceState");
	replaceBrowserUrl("#team-workspaces");
	expect(spy).toHaveBeenCalledWith({ marker: "router" }, "", "#team-workspaces");
	expect(window.location.hash).toBe("#team-workspaces");
});
