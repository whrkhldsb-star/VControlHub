import { describe, expect, it } from "vitest";

import { collapseAbsolutePaths, describeKnownError } from "./known-error-copy";

const t = (key: string) => key;

describe("describeKnownError", () => {
	it("maps ENOENT to the path-missing summary and keeps the raw detail", () => {
		const copy = describeKnownError("ENOENT: no such file or directory, scandir 'data'", t);
		expect(copy.summary).toBe("commonError.pathMissing");
		expect(copy.detail).toContain("ENOENT");
	});

	it("collapses absolute host paths in the detail so the directory layout is not exposed", () => {
		const copy = describeKnownError(
			"Scanning /srv/vcontrolhub/storage/teams/abc failed: ENOENT: no such file or directory, scandir '/srv/vcontrolhub/storage/teams/abc'",
			t,
		);
		expect(copy.detail).not.toContain("/srv/vcontrolhub");
		expect(copy.detail).toContain("…/abc");
		expect(copy.detail).toContain("ENOENT");
	});
});

describe("collapseAbsolutePaths", () => {
	it("leaves relative paths, URLs and bare words alone", () => {
		expect(collapseAbsolutePaths("open backups/x.tar.gz failed")).toBe("open backups/x.tar.gz failed");
		expect(collapseAbsolutePaths("GET https://example.com/a/b 502")).toBe("GET https://example.com/a/b 502");
		expect(collapseAbsolutePaths("/ is read-only")).toBe("/ is read-only");
	});
});
