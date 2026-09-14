import { describe, expect, it } from "vitest";
import { scanApiCopy } from "../api-copy-scanner";

describe("API copy AST audit", () => {
 it("reads the actual error argument rather than a later details property", () => {
  expect(scanApiCopy("route.ts", 'throw new ValidationError("Missing current team", { field: "teamId" });')[0]?.text).toBe("Missing current team");
 });
 it("finds multiline JSON, escaped quotes and separate errors on a translated line", () => {
  const source = `Response.json({\n error: "Missing 'file' field"\n}); t("known.key"); throw new BusinessError("Another failure");`;
  expect(scanApiCopy("route.ts", source).map((f) => f.text)).toEqual(["Missing 'file' field", "Another failure"]);
 });
 it("ignores machine identifiers, dictionary calls and explained protocol exceptions", () => {
  const source = 'Response.json({ error: "MISSING_FILE" });\nnew BusinessError(apiCopy("fileMissing"));\nResponse.json({ error: "Invalid agent payload" }); // api-copy-audit: allow -- stable machine protocol';
  expect(scanApiCopy("route.ts", source)).toEqual([]);
 });
 it("does not accept an unexplained allow directive", () => {
  expect(scanApiCopy("route.ts", 'new BusinessError("Cannot read file"); // api-copy-audit: allow')).toHaveLength(1);
 });
});
