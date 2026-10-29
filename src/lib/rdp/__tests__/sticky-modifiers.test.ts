import { describe, expect, it, vi } from "vitest";

import { createStickyModifiers, MODIFIER_KEYSYM } from "../sticky-modifiers";

describe("sticky modifiers", () => {
	it("arms a modifier for the next key only, pressing it before and releasing it after", () => {
		const onChange = vi.fn();
		const mods = createStickyModifiers(onChange);
		expect(mods.tap("ctrl")).toEqual([]);
		expect(mods.states().ctrl).toBe("armed");
		const first = mods.wrap();
		expect(first.before).toEqual([{ pressed: true, keysym: MODIFIER_KEYSYM.ctrl }]);
		expect(first.after).toEqual([{ pressed: false, keysym: MODIFIER_KEYSYM.ctrl }]);
		expect(mods.states().ctrl).toBe("off");
		// The key after that is plain.
		expect(mods.wrap()).toEqual({ before: [], after: [] });
		expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ ctrl: "off" }));
	});

	it("combines several armed modifiers, released in reverse order", () => {
		const mods = createStickyModifiers(() => {});
		mods.tap("ctrl");
		mods.tap("alt");
		const { before, after } = mods.wrap();
		expect(before.map(a => a.keysym)).toEqual([MODIFIER_KEYSYM.ctrl, MODIFIER_KEYSYM.alt]);
		expect(after.map(a => a.keysym)).toEqual([MODIFIER_KEYSYM.alt, MODIFIER_KEYSYM.ctrl]);
	});

	it("locks on the second tap (held, as for Alt+Tab pressed twice) and releases on the third", () => {
		const mods = createStickyModifiers(() => {});
		mods.tap("alt");
		expect(mods.tap("alt")).toEqual([{ pressed: true, keysym: MODIFIER_KEYSYM.alt }]);
		expect(mods.states().alt).toBe("locked");
		// A locked modifier is already down: keys are not wrapped, and it stays locked.
		expect(mods.wrap()).toEqual({ before: [], after: [] });
		expect(mods.states().alt).toBe("locked");
		expect(mods.tap("alt")).toEqual([{ pressed: false, keysym: MODIFIER_KEYSYM.alt }]);
		expect(mods.states().alt).toBe("off");
	});

	it("releases what is held when reset", () => {
		const mods = createStickyModifiers(() => {});
		mods.tap("shift");
		mods.tap("shift");
		mods.tap("ctrl");
		expect(mods.reset()).toEqual([{ pressed: false, keysym: MODIFIER_KEYSYM.shift }]);
		expect(mods.states()).toEqual({ ctrl: "off", alt: "off", shift: "off", win: "off" });
	});
});
