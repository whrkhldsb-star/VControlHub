import { afterEach, describe, expect, it, vi } from "vitest";

import { createLogger, redactSensitiveValue } from "@/lib/logging";

const ORIGINAL_ENV = process.env.NODE_ENV;

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  Reflect.set(process.env, "NODE_ENV", ORIGINAL_ENV);
});

describe("logging", () => {
  it("redacts sensitive keys and secret-looking values recursively", () => {
    const redacted = redactSensitiveValue({
      username: "admin",
      password: "REDACTED_PASSWORD_PLACEHOLDER",
      nested: {
        token: "token-value",
        privateKey: "TEST_SSH_PRIVATE_KEY_PLACEHOLDER",
        databaseUrl: "postgresql://REDACTED_DATABASE_URL_PLACEHOLDER",
      },
      list: [{ authorization: "Bearer abc123" }],
		secrets: ["plain-secret-value"],
    });

    expect(redacted).toEqual({
      username: "admin",
      password: "[REDACTED]",
      nested: {
        token: "[REDACTED]",
        privateKey: "[REDACTED]",
        databaseUrl: "[REDACTED]",
      },
      list: [{ authorization: "[REDACTED]" }],
		secrets: "[REDACTED]",
    });
  });

  it("logs handled errors in production without leaking sensitive context", () => {
    vi.stubEnv("NODE_ENV", "production");
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const logger = createLogger("test-api");

    logger.error("request failed", new Error("database password=REDACTED_PASSWORD_PLACEHOLDER"), {
      password: "REDACTED_PASSWORD_PLACEHOLDER",
      databaseUrl: "postgresql://REDACTED_DATABASE_URL_PLACEHOLDER",
      safe: "kept",
    });

    expect(errorSpy).toHaveBeenCalledTimes(1);
    const serialized = JSON.stringify(errorSpy.mock.calls[0]);
    expect(serialized).toContain("test-api");
    expect(serialized).toContain("request failed");
    expect(serialized).toContain("kept");
    expect(serialized).not.toContain("REDACTED_PASSWORD_PLACEHOLDER");
    expect(serialized).not.toContain("postgresql://REDACTED_DATABASE_URL_PLACEHOLDER");
  });
});
