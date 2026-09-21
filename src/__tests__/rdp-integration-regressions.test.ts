import { describe, expect, it } from "vitest";
import { GuacParser, instruction, validateClientInstruction } from "@/lib/rdp/protocol";

describe("RDP protocol integration regressions", () => {
 it("accepts image stream acknowledgements without enabling uploads", () => {
  expect(validateClientInstruction(["ack", "0", "OK", "0"])).toBe(true);
  expect(validateClientInstruction(["ack", "3", "Unsupported image", "256"])).toBe(true);
  for (const row of [["ack", "-1", "OK", "0"], ["ack", "0", "x".repeat(257), "0"], ["ack", "0", "OK", "65536"], ["blob", "0", "data"], ["file", "0", "text/plain", "a"]]) expect(validateClientInstruction(row)).toBe(false);
 });
 it("validates internal tunnel ping independently of daemon instructions", () => {
  expect(validateClientInstruction(["", "ping", "123456789"])).toBe(true);
  expect(validateClientInstruction(["", "ping", "NaN"])).toBe(false);
  expect(validateClientInstruction(["", "uuid"])).toBe(false);
 });
 it("caps accumulated elements across fragmented websocket messages", () => {
  const parser = new GuacParser(() => {}, 32);
  parser.feed("10.abcdefghij,");
  parser.feed("10.abcdefghij,");
  expect(() => parser.feed("10.abcdefghij;")).toThrow("too large");
 });
 it("resets aggregate size between complete instructions", () => {
  const rows: string[][] = [];
  const parser = new GuacParser(row => rows.push(row), 32);
  for (let i = 0; i < 20; i++) parser.feed(instruction("sync", "123"));
  expect(rows).toHaveLength(20);
 });
});
