import { describe, expect, it } from "vitest";
import { containsNul, stripNul, stripNulDeep } from "../strip-nul";

describe("strip-nul", () => {
  it("replaces U+0000 and leaves other text alone", () => {
    expect(stripNul("a\u0000b\u0000")).toBe("a�b�");
    const plain = "no nul here";
    expect(stripNul(plain)).toBe(plain);
  });

  it("cleans strings and keys at any depth, returning the same object when there was nothing to clean", () => {
    const clean = { a: ["x", { b: "y" }], n: 1, flag: true, none: null };
    expect(stripNulDeep(clean)).toBe(clean);
    expect(stripNulDeep({ "k\u0000": ["a\u0000", { b: "c\u0000d" }], keep: 2 })).toEqual({ "k�": ["a�", { b: "c�d" }], keep: 2 });
  });

  it("finds U+0000 anywhere in a parsed body", () => {
    expect(containsNul({ a: [{ b: "ok" }, "bad\u0000"] })).toBe(true);
    expect(containsNul({ "key\u0000": 1 })).toBe(true);
    expect(containsNul({ a: ["fine", { b: 2 }], c: null })).toBe(false);
    expect(containsNul("\\u0000 as text")).toBe(false);
  });
});
