import { describe, expect, it } from "vitest";

import nextConfig from "../../next.config";

describe("Next.js production config", () => {
  it("does not enable standalone output while the custom server owns production startup", () => {
    expect(nextConfig).not.toHaveProperty("output", "standalone");
  });
});
