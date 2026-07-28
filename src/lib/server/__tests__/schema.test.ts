import { describe, expect, it } from "vitest";

import { createServerSchema } from "../schema";

const base = {
  name: "prod-node",
  host: "203.0.113.10",
  port: 22,
  username: "root",
  connectionType: "SSH_KEY" as const,
  sshKeyId: "key-1",
};

describe("server storage path validation", () => {
  it.each(["/", "relative/path", "../escape", "/srv/../etc", "/proc", "/sys/", "/dev"])(
    "rejects unsafe storage path %s",
    (storagePath) => {
      expect(createServerSchema.safeParse({ ...base, storagePath }).success).toBe(false);
    },
  );

  it("allows an ordinary absolute storage path", () => {
    expect(createServerSchema.parse({ ...base, storagePath: "/srv/vcontrolhub/files" }).storagePath).toBe(
      "/srv/vcontrolhub/files",
    );
  });
});