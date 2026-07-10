import { describe, expect, it } from "vitest";

import { createServerSchema } from "@/lib/server/schema";

describe("createServerSchema", () => {
  it("accepts ssh-key based server onboarding payloads", () => {
    const result = createServerSchema.parse({
      name: "hk-prod-1",
      host: "203.0.113.10",
      port: 22,
      username: "root",
      sshKeyId: "key_prod_root",
      description: "Hong Kong production node",
      tags: ["prod", "hk"],
    });

    expect(result.sshKeyId).toBe("key_prod_root");
    expect(result.port).toBe(22);
  });

  it("defaults missing usernames to root", () => {
    const result = createServerSchema.parse({
      name: "hk-prod-1",
      host: "203.0.113.10",
      port: 22,
      connectionType: "PASSWORD",
      password: "secret123",
    });

    expect(result.username).toBe("root");
  });

  it("rejects onboarding without an ssh key", () => {
    expect(() =>
      createServerSchema.parse({
        name: "hk-prod-1",
        host: "203.0.113.10",
        port: 22,
        username: "root",
        sshKeyId: "",
      }),
    ).toThrow(/SSH key|password/i);
  });
});
