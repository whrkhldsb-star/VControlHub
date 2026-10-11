import { describe, expect, it } from "vitest";

import {
	DEFAULT_SSH_TERMINAL_FONT_SIZE,
	MAX_SSH_TERMINAL_FONT_SIZE,
	MIN_SSH_TERMINAL_FONT_SIZE,
	clampSshTerminalFontSize,
	parseSshTerminalFontSize,
} from "../ssh-terminal-font-size";

describe("ssh terminal font size", () => {
	it("falls back to the default when nothing usable is stored", () => {
		expect(parseSshTerminalFontSize(null)).toBe(DEFAULT_SSH_TERMINAL_FONT_SIZE);
		expect(parseSshTerminalFontSize("")).toBe(DEFAULT_SSH_TERMINAL_FONT_SIZE);
		expect(parseSshTerminalFontSize("large")).toBe(DEFAULT_SSH_TERMINAL_FONT_SIZE);
	});

	it("keeps stored sizes within the allowed range and whole pixels", () => {
		expect(parseSshTerminalFontSize("18")).toBe(18);
		expect(parseSshTerminalFontSize("17.6")).toBe(18);
		expect(parseSshTerminalFontSize("4")).toBe(MIN_SSH_TERMINAL_FONT_SIZE);
		expect(parseSshTerminalFontSize("99")).toBe(MAX_SSH_TERMINAL_FONT_SIZE);
	});

	it("clamps the stepper at both ends", () => {
		expect(clampSshTerminalFontSize(MIN_SSH_TERMINAL_FONT_SIZE - 1)).toBe(MIN_SSH_TERMINAL_FONT_SIZE);
		expect(clampSshTerminalFontSize(MAX_SSH_TERMINAL_FONT_SIZE + 1)).toBe(MAX_SSH_TERMINAL_FONT_SIZE);
		expect(clampSshTerminalFontSize(Number.NaN)).toBe(DEFAULT_SSH_TERMINAL_FONT_SIZE);
	});
});
