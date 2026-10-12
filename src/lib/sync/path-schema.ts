import { z } from "zod";

/**
 * A sync endpoint path is handed to rsync/tar on the source host and, through
 * rsync, to the target host. Quoting covers the shells, but control characters
 * (newlines, NUL) have no business in a path and only ever appear in injection
 * attempts, so they are rejected at the API boundary.
 */
export const syncEndpointPathSchema = z
	.string()
	.trim()
	.min(1)
	.max(4096)
	.refine((value) => !/[\u0000-\u001f\u007f]/.test(value), "Path must not contain control characters");
