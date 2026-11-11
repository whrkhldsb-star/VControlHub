import { createRoot } from "react-dom/client";
import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import GlobalError from "../global-error";

// The component renders a whole document; it is mounted on the document itself, as the framework does.
function mount(ui: React.ReactElement) {
	const root = createRoot(document);
	act(() => root.render(ui));
	return () => act(() => root.unmount());
}

describe("GlobalError", () => {
	let unmount: (() => void) | undefined;
	afterEach(() => {
		unmount?.();
		unmount = undefined;
		document.cookie = "vps-locale=; expires=Thu, 01 Jan 1970 00:00:00 GMT";
	});

	it("asks the server again on retry, not only for the failed answer to be rendered once more", () => {
		// `reset` renders what the boundary already has — after a failure in the root layout, that same failure.
		const reset = vi.fn();
		const retry = vi.fn();
		const error = Object.assign(new Error("An error occurred in the Server Components render."), { digest: "2574922165" });
		unmount = mount(<GlobalError error={error} reset={reset} retry={retry} />);

		expect(document.body.textContent).toContain("出错了");
		expect(document.body.textContent).toContain("错误标识: 2574922165");
		// The framework's sentence is not shown.
		expect(document.body.textContent).not.toContain("Server Components");
		act(() => document.querySelector("button")!.click());
		expect(retry).toHaveBeenCalledOnce();
		expect(reset).not.toHaveBeenCalled();
	});

	it("speaks the language of the locale cookie", () => {
		document.cookie = "vps-locale=en";
		unmount = mount(<GlobalError error={new Error("x")} reset={vi.fn()} retry={vi.fn()} />);
		expect(document.body.textContent).toContain("Something went wrong");
		expect(document.documentElement.lang).toBe("en");
	});
});
