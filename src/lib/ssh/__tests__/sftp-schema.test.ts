import { describe, expect, it } from "vitest";

/**
 * Tests for the SFTP request schemas.
 *
 * These deliberately do **not** validate path safety — traversal and jail
 * enforcement live in `assertSftpPathAccess` / `resolveRemoteRealPath`, which
 * resolve symlinks against the SSH user's home root. What the schema owns is a
 * length cap (4096, the usual PATH_MAX) and rejecting an empty path, so a body
 * cannot reach the SFTP layer with `path: ""` and be interpreted as the base
 * directory. Asserting that a traversal string parses cleanly here documents the
 * division of labour, so nobody later mistakes schema acceptance for a security
 * decision.
 */
import { deleteQuerySchema, downloadQuerySchema, listDirSchema, mkdirSchema, renameSchema } from "../sftp-schema";

const pathSchemas = { listDirSchema, mkdirSchema, downloadQuerySchema, deleteQuerySchema };

describe.each(Object.entries(pathSchemas))("%s", (_name, schema) => {
	it("accepts an ordinary absolute path", () => {
		expect(schema.safeParse({ path: "/home/deploy/app.log" }).success).toBe(true);
	});

	it("rejects an empty path so it cannot be read as the base directory", () => {
		expect(schema.safeParse({ path: "" }).success).toBe(false);
		expect(schema.safeParse({}).success).toBe(false);
	});

	it("rejects a path over 4096 characters", () => {
		expect(schema.safeParse({ path: "/" + "a".repeat(4096) }).success).toBe(false);
		expect(schema.safeParse({ path: "a".repeat(4096) }).success).toBe(true);
	});

	it("accepts a traversal string — path safety is enforced downstream, not here", () => {
		// `assertSftpPathAccess` + remote realpath own the jail; the schema must not
		// be mistaken for that guard.
		expect(schema.safeParse({ path: "../../etc/passwd" }).success).toBe(true);
	});

	it("does not trim, so a caller-visible path reaches the ACL check verbatim", () => {
		expect(schema.parse({ path: " /tmp/x " }).path).toBe(" /tmp/x ");
	});
});

describe("renameSchema", () => {
	it("requires both paths", () => {
		expect(renameSchema.safeParse({ oldPath: "/a" }).success).toBe(false);
		expect(renameSchema.safeParse({ newPath: "/b" }).success).toBe(false);
		expect(renameSchema.safeParse({ oldPath: "/a", newPath: "/b" }).success).toBe(true);
	});

	it("rejects an empty path on either side", () => {
		expect(renameSchema.safeParse({ oldPath: "", newPath: "/b" }).success).toBe(false);
		expect(renameSchema.safeParse({ oldPath: "/a", newPath: "" }).success).toBe(false);
	});

	it("caps both paths at 4096 characters", () => {
		expect(renameSchema.safeParse({ oldPath: "a".repeat(4097), newPath: "/b" }).success).toBe(false);
		expect(renameSchema.safeParse({ oldPath: "/a", newPath: "b".repeat(4097) }).success).toBe(false);
	});
});
