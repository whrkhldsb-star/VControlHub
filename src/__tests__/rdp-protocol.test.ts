import { describe, expect, it } from "vitest";
import { GuacParser, instruction, validateClientInstruction, rdpProfileSchema, assertPublicRdpHost } from "@/lib/rdp/protocol";

describe("RDP protocol security", () => {
 it("frames fragmented unicode instructions", () => {
  const rows: string[][] = []; const parser = new GuacParser(row => rows.push(row));
  const data = instruction("name", "桌面😀");
  for (const char of data) parser.feed(char);
  expect(rows).toEqual([["name", "桌面😀"]]);
 });
 it("rejects malformed and oversized frames", () => {
  expect(() => new GuacParser(() => {}).feed("x.bad;")).toThrow();
  expect(() => new GuacParser(() => {}).feed("99999999.a")).toThrow();
 });
 it("allows only bounded screen input, never clipboard/files", () => {
  expect(validateClientInstruction(["key", "65293", "1"])).toBe(true);
  expect(validateClientInstruction(["mouse", "12", "22", "1"])).toBe(true);
  for (const op of ["clipboard", "file", "pipe", "blob", "connect", "select", "audio"]) expect(validateClientInstruction([op,"0"])).toBe(false);
  expect(validateClientInstruction(["size", "999999", "1"])).toBe(false);
 });
 it("allows clipboard stream instructions only when the channel is opted in", () => {
  expect(validateClientInstruction(["clipboard", "2", "text/plain"], { clipboard: true })).toBe(true);
  expect(validateClientInstruction(["clipboard", "2", "text/plain;charset=utf-8"], { clipboard: true })).toBe(true);
  expect(validateClientInstruction(["blob", "2", "aGVsbG8="], { clipboard: true })).toBe(true);
  expect(validateClientInstruction(["end", "2"], { clipboard: true })).toBe(true);
  for (const row of [["clipboard", "2", "text/plain"], ["blob", "2", "aGVsbG8="], ["end", "2"]]) expect(validateClientInstruction(row)).toBe(false);
  expect(validateClientInstruction(["clipboard", "2", "application/octet-stream"], { clipboard: true })).toBe(false);
  expect(validateClientInstruction(["blob", "2", "not base64!"], { clipboard: true })).toBe(false);
  expect(validateClientInstruction(["blob", "2", "A".repeat(6049)], { clipboard: true })).toBe(false);
  expect(validateClientInstruction(["file", "2", "text/plain", "x"], { clipboard: true })).toBe(false);
 });
 it("preserves passwords and accepts domain accounts", () => {
  expect(rdpProfileSchema.parse({name:"Win",host:"2.26.201.79",port:3389,username:"Administrator",password:" secret ",domain:"CORP"}).password).toBe(" secret ");
 });
 it("blocks loopback, private, metadata and noncanonical endpoints", () => {
  for(const host of ["127.0.0.1","169.254.169.254","10.1.2.3","::1","2130706433","localhost","192.168.1.1","100.64.0.1","0.0.0.0","224.0.0.1"]) expect(() => assertPublicRdpHost(host)).toThrow();
  expect(() => assertPublicRdpHost("2.26.201.79")).not.toThrow();
 });
});
