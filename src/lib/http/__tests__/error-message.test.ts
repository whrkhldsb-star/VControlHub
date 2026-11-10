import { describe, expect, it } from "vitest";
import { z } from "zod";

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

  it("shows what a schema refused, not the dump of its issues", () => {
    // What the server form showed for a host typed as a URL: `[\n  {\n    "code": "custom", …` (ZodError.message).
    const schema = z.object({
      name: z.string().min(2, "Node name must be at least 2 characters"),
      host: z.string().refine((value) => !value.includes("/"), "Host contains invalid characters"),
    });
    let thrown: unknown;
    try {
      schema.parse({ name: "a", host: "http://203.0.113.5" });
    } catch (error) {
      thrown = error;
    }
    expect(getErrorMessage(thrown, "Could not save")).toBe("Node name must be at least 2 characters; Host contains invalid characters");

    const repeated = z.array(z.string().min(1, "Tag cannot be empty")).safeParse(["", "", ""]).error;
    expect(getErrorMessage(repeated, "Could not save")).toBe("Tag cannot be empty");
    expect(getErrorMessage(new z.ZodError([]), "Could not save")).toBe("Could not save");
  });
});
