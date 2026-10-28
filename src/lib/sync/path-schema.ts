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
	.refine((value) => !/[\u0000-\u001f\u007f]/.test(value), "Path must not contain control characters")
	// rsync reads a leading "-" as an option and "host:path" / "rsync://host/module" as another machine, so a path
	// like "--rsync-path=/bin/sh -c id" or "evil.example:/data" made the source host run a command or connect out
	// with the target's credentials.
	.refine((value) => !value.startsWith("-"), "Path must not start with '-'")
	.refine((value) => !/^[^/]*:/.test(value), "Path must not look like host:path or a URL");
