import { apiCopy } from "@/lib/i18n/api-copy";
import { formatBytes } from "@/lib/format/bytes";
import { ArchiveExtractError, MAX_EXTRACT_BYTES, MAX_EXTRACT_ENTRIES } from "./archive-extract";

/** The user-facing reason an archive could not be listed or extracted. */
export function archiveErrorCopy(error: ArchiveExtractError): string {
	switch (error.code) {
		case "unsafePath":
			return apiCopy("apiCopy.archive.unsafePath", { v0: error.detail });
		case "tooManyEntries":
			return apiCopy("apiCopy.archive.tooManyEntries", { v0: MAX_EXTRACT_ENTRIES });
		case "tooLarge":
			return apiCopy("apiCopy.archive.tooLarge", { v0: formatBytes(MAX_EXTRACT_BYTES) });
		case "encrypted":
			return apiCopy("apiCopy.archive.encrypted", { v0: error.detail });
		case "unsupportedMethod":
			return apiCopy("apiCopy.archive.unsupportedMethod", { v0: error.detail });
		case "empty":
			return apiCopy("apiCopy.archive.empty");
		default:
			return apiCopy("apiCopy.archive.corrupt");
	}
}
