/**
 * Streamed SHA-256 of a file (TR: one copy; backup migration packages and the
 * storage offsite S3 client used to duplicate this verbatim).
 *
 * Streams chunk-by-chunk so multi-gigabyte backup archives do not have to fit
 * in memory; rejects with the underlying stream error (e.g. ENOENT) and
 * resolves to the lowercase hex digest on success.
 */
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";

export function sha256File(filePath: string): Promise<string> {
	return new Promise((resolve, reject) => {
		const hash = createHash("sha256");
		const stream = createReadStream(filePath);
		stream.on("data", (chunk) => hash.update(chunk));
		stream.on("error", reject);
		stream.on("end", () => resolve(hash.digest("hex")));
	});
}
