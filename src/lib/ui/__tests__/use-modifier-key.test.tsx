// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { modifierKeyOf, useModifierKey } from "../use-modifier-key";

function Hint() {
	return <kbd>{useModifierKey()}</kbd>;
}

describe("the palette's modifier key", () => {
	afterEach(() => vi.unstubAllGlobals());

	it("is ⌘ on Apple systems and Ctrl everywhere else", () => {
		expect(modifierKeyOf("MacIntel")).toBe("⌘");
		expect(modifierKeyOf("macOS")).toBe("⌘");
		expect(modifierKeyOf("iPhone")).toBe("⌘");
		expect(modifierKeyOf("Win32")).toBe("Ctrl");
		expect(modifierKeyOf("Windows")).toBe("Ctrl");
		expect(modifierKeyOf("Linux x86_64")).toBe("Ctrl");
		expect(modifierKeyOf("")).toBe("Ctrl");
	});

	it("follows the keyboard of the device showing the page", () => {
		vi.stubGlobal("navigator", { platform: "Win32", userAgent: "" });
		const { unmount } = render(<Hint />);
		expect(screen.getByText("Ctrl")).toBeInTheDocument();
		unmount();

		vi.stubGlobal("navigator", { userAgentData: { platform: "macOS" }, platform: "", userAgent: "" });
		render(<Hint />);
		expect(screen.getByText("⌘")).toBeInTheDocument();
	});
});
