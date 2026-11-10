import { describe, expect, it } from "vitest";

import { createCommandSchema, reviewCommandSchema } from "@/lib/command/schema";

describe("command schema", () => {
  it("accepts batch command submission payloads", () => {
    const payload = createCommandSchema.parse({
      title: "Batch update",
      command: "apt update",
      reason: "Patch window",
      submissionMode: "assistant",
      requesterId: "u_1",
      serverIds: ["srv_1", "srv_2"],
    });

    expect(payload.serverIds).toHaveLength(2);
  });

  it("requires at least one target server", () => {
    expect(() =>
      createCommandSchema.parse({
        title: "Batch update",
        command: "apt update",
        submissionMode: "assistant",
        requesterId: "u_1",
        serverIds: [],
      }),
    ).toThrow(/At least 1 target VPS must be selected/i);
  });

  it("accepts approval reviews", () => {
    const payload = reviewCommandSchema.parse({
      commandRequestId: "cmd_1",
      approverId: "u_admin",
      approved: true,
      comment: "允许执行",
    });

    expect(payload.approved).toBe(true);
  });
});

describe("commandRequestTitle", () => {
  it("keeps a title built from a long name within what a command request accepts", async () => {
    const { commandRequestTitle, createCommandSchema, COMMAND_TITLE_MAX_LENGTH } = await import("../schema");
    const base = { command: "uptime", submissionMode: "user" as const, requesterId: "u1", serverIds: ["s1"] };
    // A scheduled task name may be 100 characters, a template name 120: with their label in front, both
    // titles were over the limit, and every retry / deployment of them was refused.
    for (const [label, name] of [["Scheduled task retry: ", "n".repeat(100)], ["Deployment: ", "t".repeat(120)], ["Rollback deployment: ", "t".repeat(120)]] as const) {
      expect(() => createCommandSchema.parse({ ...base, title: `${label}${name}` })).toThrow(/at most 120/);
      const title = commandRequestTitle(label, name);
      expect(title).toHaveLength(COMMAND_TITLE_MAX_LENGTH);
      expect(title.startsWith(label)).toBe(true);
      expect(title.endsWith("…")).toBe(true);
      expect(createCommandSchema.parse({ ...base, title }).title).toBe(title);
    }
    expect(commandRequestTitle("Deployment: ", "Nginx Restart")).toBe("Deployment: Nginx Restart");
    // The cut does not leave half of an emoji behind.
    const emoji = commandRequestTitle("Deployment: ", `${"x".repeat(106)}🚀 release`);
    expect(emoji).toBe(`Deployment: ${"x".repeat(106)}…`);
  });
});
