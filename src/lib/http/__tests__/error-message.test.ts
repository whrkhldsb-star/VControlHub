import { describe, expect, it } from "vitest";

import { getErrorMessage } from "../error-message";

describe("getErrorMessage", () => {
  it("passes an error's own message through", () => {
    expect(getErrorMessage(new Error("SSH connection refused"), "fallback")).toBe("SSH connection refused");
    expect(getErrorMessage(new Error(""), "fallback")).toBe("fallback");
    expect(getErrorMessage("not an error", "fallback")).toBe("fallback");
  });

  it("never shows a database error's message", () => {
    // What server actions used to show for a duplicate name, verbatim.
    const unique = Object.assign(new Error("\nInvalid `prisma.sshKey.create()` invocation:\n\n\nUnique constraint failed on the fields: (`fingerprint`)"), {
      name: "PrismaClientKnownRequestError",
      code: "P2002",
      clientVersion: "7.9.0",
    });
    expect(getErrorMessage(unique, "Could not save the SSH key")).toBe("Could not save the SSH key");
    const validation = Object.assign(new Error("Invalid `prisma.role.findMany()` invocation"), { name: "PrismaClientValidationError", clientVersion: "7.9.0" });
    expect(getErrorMessage(validation, "Failed")).toBe("Failed");
  });
});
