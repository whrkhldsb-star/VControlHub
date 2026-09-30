import { createHash, randomUUID } from "node:crypto";
import { lstat, readdir, realpath, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { sha256File } from "@/lib/crypto/sha256-file";
import { loadOffsiteConfig, validateOffsiteConfigForUse } from "@/lib/storage/offsite/schema";
import { S3Client } from "@/lib/storage/offsite/s3-client";

/** Full recovery archives contain keys. This independent opt-in stays off by default. */
export async function uploadRecoveryBackup(input: { directory: string; enabled: boolean }) {
	if (!input.enabled) return { skipped: true, reason: "recovery_offsite_disabled" } as const;
	const config = await loadOffsiteConfig();
	if (!config.enabled) return { skipped: true, reason: "offsite_disabled" } as const;
	if (validateOffsiteConfigForUse(config).length || new URL(config.endpoint).protocol !== "https:") throw new Error("Recovery offsite upload requires valid S3 configuration and HTTPS");
	const directory = await realpath(input.directory);
	const names = (await readdir(directory)).filter(name => /^[a-zA-Z0-9_-]+_full_\d{8}_\d{6}\.tar\.gz$/.test(name)).sort((a, b) => b.slice(-22).localeCompare(a.slice(-22)));
	if (!names.length) throw new Error("No completed full recovery archive is available");
	const name = names[0]!;
	const filePath = path.join(directory, name);
	const info = await lstat(filePath);
	if (!info.isFile() || info.isSymbolicLink() || info.size < 1) throw new Error("Recovery upload source must be a nonempty regular archive");
	if (process.platform !== "win32" && (info.mode & 0o077)) throw new Error("Recovery archive permissions must be private (0600)");
	const digest = await sha256File(filePath);
	const key = `${config.pathPrefix.replace(/\/+$/, "")}/recovery/${name.slice(0, -7)}-${digest}.tar.gz`.replace(/^\//, "");
	const client = new S3Client({ endpoint: config.endpoint, region: config.region, bucket: config.bucket, accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey, timeoutMs: 30 * 60 * 1000 });
	const existing = await client.headObject(key);
	if (!existing || existing.size !== info.size) await client.putFile(key, filePath, "application/gzip");
	// Read the stored object back as a stream; a successful PUT or matching
	// byte count alone cannot establish that the recovery copy is intact.
	const remote = await client.getObject(key);
	if (!remote || remote.size !== info.size) throw new Error("Offsite recovery copy size verification failed; local archive retained");
	const hash = createHash("sha256");
	let received = 0;
	for await (const chunk of Readable.fromWeb(remote.body as import("node:stream/web").ReadableStream<Uint8Array>)) {
		received += chunk.length;
		if (received > info.size) throw new Error("Offsite recovery copy exceeded its expected size; local archive retained");
		hash.update(chunk);
	}
	if (received !== info.size || hash.digest("hex") !== digest) throw new Error("Offsite recovery copy SHA-256 verification failed; local archive retained");
	const receipt = { key, sha256: digest, bytes: received, verifiedAt: new Date().toISOString() };
	const temporary = `${filePath}.offsite.json.partial-${randomUUID()}`;
	try {
		await writeFile(temporary, JSON.stringify(receipt) + "\n", { mode: 0o600, flag: "wx" });
		await rename(temporary, `${filePath}.offsite.json`);
	} finally { await rm(temporary, { force: true }); }
	return { skipped: false, ...receipt } as const;
}
