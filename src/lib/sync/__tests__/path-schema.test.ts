import { describe, expect, it } from "vitest";

import { syncEndpointPathSchema } from "../path-schema";
import { isProtectedDeleteTarget } from "../bidirectional";

describe("syncEndpointPathSchema", () => {
	it.each(["/srv/data", "backups/db", "/srv/with space/it's ok", "relative-dir/sub", "/a:b/c"])("accepts %s", (value) => {
		expect(syncEndpointPathSchema.safeParse(value).success).toBe(true);
	});

	it.each([
		"-n",
		"--rsync-path=/bin/sh -c id",
		"evil.example:/data",
		"user@evil.example:/data",
		"rsync://evil/module",
		"/srv/line\nbreak",
		"",
	])("rejects %s: rsync would read it as an option or another machine", (value) => {
		expect(syncEndpointPathSchema.safeParse(value).success).toBe(false);
	});
});

describe("isProtectedDeleteTarget", () => {
	it.each(["/", "/etc", "/etc/", "//usr", "/var/.", "/srv/../etc"])("protects %s", (value) => {
		expect(isProtectedDeleteTarget(value)).toBe(true);
	});

	it.each(["/etc/nginx", "/var/www", "/opt", "/srv/data", "/home/app"])("lets %s through", (value) => {
		expect(isProtectedDeleteTarget(value)).toBe(false);
	});
});
