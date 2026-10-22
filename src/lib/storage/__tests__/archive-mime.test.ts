import { describe, expect, it } from "vitest";

import { guessMimeType } from "@/lib/image-bed/constants";
import { archiveKindOf } from "../archive-extract";
import { isPreviewableFile } from "../mime-constants";

/**
 * Every archive the online viewer reads gets a type when a folder is
 * indexed, so the file list offers its preview. .tgz and .jar had none.
 */
describe("archive types the viewer reads", () => {
	it.each(["bundle.zip", "app.jar", "site.tar", "site.tar.gz", "site.tgz"])("indexes %s as a previewable archive", (name) => {
		expect(archiveKindOf(name)).not.toBeNull();
		const mimeType = guessMimeType(name);
		expect(mimeType).not.toBeNull();
		expect(isPreviewableFile({ mimeType, name })).toBe(true);
	});
});
