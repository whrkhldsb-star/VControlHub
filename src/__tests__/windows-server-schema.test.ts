import { describe, expect, it } from "vitest";
import { createServerSchema } from "@/lib/server/schema";

describe("unified server profile validation", () => {
 const windows = { operatingSystem: "WINDOWS", name: "Windows VPS", host: "8.8.8.8", username: "DOMAIN\\Administrator", rdpPassword: "  exact password  " };
 it("accepts Windows without SSH and preserves password bytes", () => {
  const value = createServerSchema.parse(windows);
  expect(value).toMatchObject({ operatingSystem: "WINDOWS", port: 3389, rdpPassword: "  exact password  " });
 });
 it("keeps legacy Linux defaults", () => {
  expect(createServerSchema.parse({name: "Linux", host: "example.com", sshKeyId: "key"})).toMatchObject({ operatingSystem: "LINUX", port: 22 });
 });
 it("accepts Windows Agent mode (manual PowerShell bootstrap, no SSH channel)", () => {
  const value = createServerSchema.parse({ ...windows, managementMode: "AGENT" });
  expect(value).toMatchObject({ operatingSystem: "WINDOWS", managementMode: "AGENT" });
 });
 it.each([{rdpPassword:""}, {host:"127.0.0.1"}, {host:"internal.example"}, {port:0}, {enableDirectGateway:true}])("rejects invalid Windows %j", bad => {
  expect(createServerSchema.safeParse({...windows,...bad}).success).toBe(false);
 });
});
