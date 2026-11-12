import { renderHook } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { useBrowserOrigin } from "../use-browser-origin";

function Shown() {
	return <span>{useBrowserOrigin()}/api/itsm/inbound/conn-1</span>;
}

describe("useBrowserOrigin", () => {
	it("is the page's origin in the browser", () => {
		expect(renderHook(() => useBrowserOrigin()).result.current).toBe(window.location.origin);
	});

	it("is empty while rendering on the server, whatever the environment has", () => {
		expect(renderToString(<Shown />)).toContain(">/api/itsm/inbound/conn-1<");
	});
});
