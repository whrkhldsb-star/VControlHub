import { describe, expect, it } from "vitest";

import {
	BUILDER_KEYS,
	buildQuickKeyPreset,
	encodeQuickKeySequence,
	parseQuickKeyPresets,
	quickKeyPresetsToEntries,
	serializeQuickKeyPresets,
} from "../ssh-quick-keys";

describe("encodeQuickKeySequence", () => {
	it("encodes Ctrl+letter to control codes", () => {
		expect(encodeQuickKeySequence({ keyId: "c", modifiers: ["ctrl"] })).toBe("\u0003");
		expect(encodeQuickKeySequence({ keyId: "z", modifiers: ["ctrl"] })).toBe("\u001a");
	});

	it("encodes Shift+Tab as the backward-tab CSI", () => {
		expect(encodeQuickKeySequence({ keyId: "tab", modifiers: ["shift"] })).toBe("\u001b[Z");
	});

	it("encodes bare arrows and Ctrl+arrows", () => {
		expect(encodeQuickKeySequence({ keyId: "up", modifiers: [] })).toBe("\u001b[A");
		expect(encodeQuickKeySequence({ keyId: "left", modifiers: ["ctrl"] })).toBe("\u001b[1;5D");
	});

	it("encodes Alt variants with an ESC prefix", () => {
		expect(encodeQuickKeySequence({ keyId: "b", modifiers: ["alt"] })).toBe("\u001bb");
		expect(encodeQuickKeySequence({ keyId: "c", modifiers: ["ctrl", "alt"] })).toBe("\u001b\u0003");
	});

	it("encodes Shift+letter as uppercase", () => {
		expect(encodeQuickKeySequence({ keyId: "f", modifiers: ["shift"] })).toBe("F");
	});

	it("throws for unknown key ids", () => {
		expect(() => encodeQuickKeySequence({ keyId: "nope", modifiers: [] })).toThrow();
	});

	it("builder keys cover letters, digits and specials", () => {
		expect(BUILDER_KEYS.some((k) => k.id === "a")).toBe(true);
		expect(BUILDER_KEYS.some((k) => k.id === "0")).toBe(true);
		expect(BUILDER_KEYS.some((k) => k.id === "pagedown")).toBe(true);
	});
});

describe("quick key preset labels", () => {
	it("orders modifiers Ctrl, Shift, Alt", () => {
		const preset = buildQuickKeyPreset({ keyId: "tab", modifiers: ["alt", "shift", "ctrl"] });
		expect(preset.label).toBe("Ctrl+Shift+Alt+Tab");
	});
});

describe("preset persistence", () => {
	it("round-trips presets through serialize/parse", () => {
		const presets = [
			buildQuickKeyPreset({ keyId: "tab", modifiers: ["shift"] }),
			buildQuickKeyPreset({ keyId: "c", modifiers: ["ctrl"] }),
		];
		const parsed = parseQuickKeyPresets(serializeQuickKeyPresets(presets));
		expect(parsed).toEqual(presets);
	});

	it("returns null for malformed storage", () => {
		expect(parseQuickKeyPresets(null)).toBeNull();
		expect(parseQuickKeyPresets("not json")).toBeNull();
		expect(parseQuickKeyPresets('[{"label":"x"}]')).toBeNull();
		expect(parseQuickKeyPresets('[{"label":"x","sequence":{"keyId":"c","modifiers":["win"]}}]')).toBeNull();
	});

	it("falls back to defaults when no presets stored and skips invalid entries", () => {
		expect(quickKeyPresetsToEntries(null)[0]?.label).toBe("Ctrl+C");
		// All entries invalid → empty list falls back to the defaults too.
		const invalid = [{ label: "Bad", sequence: { keyId: "nope", modifiers: [] } }];
		const entries = quickKeyPresetsToEntries(invalid as never);
		expect(entries).toEqual(quickKeyPresetsToEntries(null));
	});
});
