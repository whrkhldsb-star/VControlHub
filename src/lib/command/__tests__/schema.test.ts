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
