import { describe, expect, it } from "vitest";

import { csvCell, csvRow } from "../csv";

describe("csvCell", () => {
	it("passes plain values through untouched", () => {
		expect(csvCell("download")).toBe("download");
		expect(csvCell(42)).toBe("42");
		expect(csvCell(null)).toBe("");
		expect(csvCell(undefined)).toBe("");
	});

	it("quotes and escapes separators, quotes and newlines", () => {
		expect(csvCell("a,b")).toBe('"a,b"');
		expect(csvCell('say "hi"')).toBe('"say ""hi"""');
		expect(csvCell("line1\nline2")).toBe('"line1\nline2"');
		expect(csvCell("line1\rline2")).toBe('"line1\rline2"');
		// A leading CR is a formula-smuggling trick, so that one does get prefixed.
		expect(csvCell("\r=1+1")).toBe('"\'\r=1+1"');
	});

	it("neutralises spreadsheet formulas coming from untrusted text", () => {
		// A share visitor controls their user agent; a file name is user input.
		expect(csvCell("=1+1")).toBe("'=1+1");
		expect(csvCell("+HYPERLINK(\"http://evil\")")).toBe(
			'"\'+HYPERLINK(""http://evil"")"',
		);
		expect(csvCell("-2+3")).toBe("'-2+3");
		expect(csvCell("@SUM(A1)")).toBe("'@SUM(A1)");
		expect(csvCell("\t=cmd|' /c calc'!A0")).toBe("'\t=cmd|' /c calc'!A0");
	});

	it("does not touch a formula character that is not leading", () => {
		expect(csvCell("nginx-1.2=ok")).toBe("nginx-1.2=ok");
	});
});

describe("csvRow", () => {
	it("joins encoded cells with commas", () => {
		expect(csvRow(["ok", "a,b", "=1"])).toBe('ok,"a,b",\'=1');
	});
});
