// @vitest-environment node
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ config: vi.fn(), putFile: vi.fn(), head: vi.fn(), get: vi.fn() }));
vi.mock("@/lib/storage/offsite/schema", () => ({ loadOffsiteConfig: mocks.config, validateOffsiteConfigForUse: () => [] }));
vi.mock("@/lib/storage/offsite/s3-client", () => ({ S3Client: class { putFile = mocks.putFile; headObject = mocks.head; getObject = mocks.get; } }));
import { uploadRecoveryBackup } from "../recovery-offsite";

let directory: string;
const name = "VControlHub_full_20260930_110000.tar.gz";
const bytes = Buffer.from("isolated full recovery test artifact");
beforeEach(async () => {
	vi.resetAllMocks();
	directory = await mkdtemp(path.join(tmpdir(), "vch-recovery-offsite-"));
	await writeFile(path.join(directory, name), bytes, { mode: 0o600 });
	mocks.config.mockResolvedValue({ enabled: true, endpoint: "https://backup.example.test", region: "test", bucket: "private", pathPrefix: "vcontrolhub-backups/", accessKeyId: "fixture", secretAccessKey: "fixture-only" });
	mocks.head.mockResolvedValue(null);
	mocks.get.mockImplementation(async () => ({ size: bytes.length, body: new ReadableStream({ start(controller) { controller.enqueue(bytes); controller.close(); } }) }));
});
afterEach(async () => { await rm(directory, { recursive: true, force: true }); });

it("stays completely disabled until explicitly enabled", async () => {
	await expect(uploadRecoveryBackup({ directory, enabled: false })).resolves.toMatchObject({ skipped: true, reason: "recovery_offsite_disabled" });
	expect(mocks.config).not.toHaveBeenCalled();
	expect(mocks.putFile).not.toHaveBeenCalled();
});

it("streams a published full archive and writes a receipt only after read-back verification", async () => {
	const result = await uploadRecoveryBackup({ directory, enabled: true });
	expect(result.skipped).toBe(false);
	expect(mocks.putFile).toHaveBeenCalledWith(expect.stringContaining("recovery/"), path.join(directory, name), "application/gzip");
	const receipt = JSON.parse(await readFile(path.join(directory, `${name}.offsite.json`), "utf8"));
	expect(receipt).toMatchObject({ bytes: bytes.length, sha256: expect.stringMatching(/^[a-f0-9]{64}$/) });
	expect(JSON.stringify(receipt)).not.toContain("fixture-only");
});

it("rejects same-size corrupted remote data while preserving the local recovery archive", async () => {
	mocks.get.mockResolvedValue({ size: bytes.length, body: new ReadableStream({ start(controller) { controller.enqueue(Buffer.alloc(bytes.length)); controller.close(); } }) });
	await expect(uploadRecoveryBackup({ directory, enabled: true })).rejects.toThrow("SHA-256 verification failed");
	expect(await readFile(path.join(directory, name))).toEqual(bytes);
	expect(await readdir(directory)).toEqual([name]);
});

it("verifies an already stored object without uploading duplicate bytes", async () => {
	mocks.head.mockResolvedValue({ size: bytes.length });
	await uploadRecoveryBackup({ directory, enabled: true });
	expect(mocks.putFile).not.toHaveBeenCalled();
	expect(mocks.get).toHaveBeenCalledTimes(1);
});

it("rejects a non-TLS recovery destination before sending any archive", async () => {
	mocks.config.mockResolvedValue({ enabled: true, endpoint: "http://backup.example.test" });
	await expect(uploadRecoveryBackup({ directory, enabled: true })).rejects.toThrow("HTTPS");
	expect(mocks.putFile).not.toHaveBeenCalled();
});
