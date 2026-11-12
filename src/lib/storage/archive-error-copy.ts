import { apiCopy } from "@/lib/i18n/api-copy";
import { formatBytes } from "@/lib/format/bytes";
import { ArchiveExtractError, MAX_EXTRACT_BYTES, MAX_EXTRACT_ENTRIES } from "./archive-extract";
import { EXTERNAL_ARCHIVE_TOOL, type ExternalArchiveError } from "./archive-external-list";

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
		case "duplicateName":
			return apiCopy("apiCopy.archive.duplicateName", { v0: error.detail });
		default:
			return apiCopy("apiCopy.archive.corrupt");
	}
}

/** The user-facing reason a .7z or .rar archive could not be listed with the server's own tool. */
export function externalArchiveErrorCopy(error: ExternalArchiveError): string {
	switch (error.code) {
		case "toolMissing":
			return apiCopy("apiCopy.archive.toolMissing", { v0: EXTERNAL_ARCHIVE_TOOL[error.kind], v1: `.${error.kind}` });
		case "passwordProtected":
			return apiCopy("apiCopy.archive.passwordProtected");
		case "listingTooLarge":
			return apiCopy("apiCopy.archive.listingTooLarge");
		default:
			return apiCopy("apiCopy.archive.corrupt");
	}
}
