import { describe, expect, it, vi, beforeEach } from "vitest";
import { Readable } from "node:stream";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve as resolvePath } from "node:path";
import { tmpdir } from "node:os";

import { ConflictError } from "@/lib/errors";
import { config } from "@/lib/config/env";
import type { OffsiteConfig } from "@/lib/storage/offsite/schema";

const offsiteMocks = vi.hoisted(() => ({
  // Default matches the real disabled-config behaviour so existing run tests
  // keep skipping the best-effort offsite step.
  loadConfig: vi.fn(async (): Promise<Record<string, unknown>> => ({ enabled: false, failureAlertRecipient: null })),
  putFile: vi.fn(),
  constructedWith: [] as Array<Record<string, unknown>>,
}));

/** Complete enabled S3 config — every field of OffsiteConfig is required at use time. */
const ENABLE_OFFSITE_CONFIG: OffsiteConfig = {
  enabled: true,
  provider: "s3",
  endpoint: "https://s3.example.com",
  region: "us-east-1",
  bucket: "backups",
  accessKeyId: "ak",
  secretAccessKey: "sk",
  pathPrefix: "vps-backups/",
  dailyWindowHour: 2,
  retentionDays: 30,
  failureAlertRecipient: "",
};

const mocks = vi.hoisted(() => ({
  findUnique: vi.fn(),
  updateMany: vi.fn(),
  update: vi.fn(),
  create: vi.fn(),
  findMany: vi.fn(),
  delete: vi.fn(),
  deleteMany: vi.fn(),
  execRemoteCommand: vi.fn(),
  buildSshParamsFromServer: vi.fn(),
  downloadFile: vi.fn(),
  getPreset: vi.fn(),
  buildRemoteBackupCommand: vi.fn(),
  buildRemoteCleanupCommand: vi.fn(),
  generateRemoteBackupPath: vi.fn(),
}));

vi.mock("@/lib/storage/offsite/schema", () => ({
  loadOffsiteConfig: offsiteMocks.loadConfig,
  validateOffsiteConfigForUse: () => [],
}));

vi.mock("@/lib/storage/offsite/s3-client", () => ({
  S3Client: class {
    constructor(clientConfig: Record<string, unknown>) {
      offsiteMocks.constructedWith.push(clientConfig);
    }
    putFile = offsiteMocks.putFile;
  },
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    vpsBackupRecord: {
      findUnique: mocks.findUnique,
      updateMany: mocks.updateMany,
      update: mocks.update,
      create: mocks.create,
      findMany: mocks.findMany,
      delete: mocks.delete,
      deleteMany: mocks.deleteMany,
    },
  },
}));

vi.mock("@/lib/ssh/client", () => ({
  buildSshParamsFromServer: mocks.buildSshParamsFromServer,
  execRemoteCommand: mocks.execRemoteCommand,
}));

vi.mock("@/lib/ssh/sftp-service", () => ({
  downloadFile: mocks.downloadFile,
}));

vi.mock("../vps-backup-presets", () => ({
  getPreset: mocks.getPreset,
  buildRemoteBackupCommand: mocks.buildRemoteBackupCommand,
  buildRemoteCleanupCommand: mocks.buildRemoteCleanupCommand,
  generateRemoteBackupPath: mocks.generateRemoteBackupPath,
}));

const {
  runVpsBackupRecord,
  assertPortableVpsBackupPath,
  deleteVpsBackupRecord,
  retryPendingVpsOffsiteUploads,
  abandonStalePendingVpsBackupRecords,
} = await import("../vps-backup-service");

const storageRoot = join(tmpdir(), `vch-vps-backup-test-${process.pid}`);

function baseRecord() {
  return {
    id: "rec_1",
    serverId: "srv_1",
    backupType: "nginx-config",
    status: "PENDING",
    server: {
      id: "srv_1",
      host: "10.0.0.1",
      port: 22,
      username: "root",
      sshKeyId: null,
      password: "secret",
      sshKey: null,
      enabled: true,
    },
    schedule: null,
  };
}

describe("abandonStalePendingVpsBackupRecords", () => {
  beforeEach(() => {
    mocks.findMany.mockReset();
    mocks.updateMany.mockReset();
  });

  it("CAS-fails stale PENDING rows and returns the abandoned ids", async () => {
    mocks.findMany.mockResolvedValue([{ id: "rec_a" }, { id: "rec_b" }]);
    mocks.updateMany.mockResolvedValue({ count: 1 });

    const result = await abandonStalePendingVpsBackupRecords();

    expect(result.abandoned).toBe(2);
    expect(result.ids).toEqual(["rec_a", "rec_b"]);
    // Only PENDING rows older than the cutoff are candidates.
    expect(mocks.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ status: "PENDING" }),
      }),
    );
    // Each row is failed via a status-guarded CAS — never a blind update — so a
    // row a worker just claimed to RUNNING is left untouched.
    expect(mocks.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "rec_a", status: "PENDING" },
        data: expect.objectContaining({ status: "FAILED" }),
      }),
    );
  });

  it("skips a row already claimed to RUNNING (CAS count 0)", async () => {
    mocks.findMany.mockResolvedValue([{ id: "rec_a" }]);
    mocks.updateMany.mockResolvedValue({ count: 0 });

    const result = await abandonStalePendingVpsBackupRecords();

    expect(result.abandoned).toBe(0);
    expect(result.ids).toEqual([]);
  });
});

describe("runVpsBackupRecord false-success guards", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.VCH_STORAGE_ROOT = storageRoot;
    rmSync(storageRoot, { recursive: true, force: true });
    mkdirSync(storageRoot, { recursive: true });

    mocks.findUnique.mockResolvedValue(baseRecord());
    mocks.updateMany.mockResolvedValue({ count: 1 });
    mocks.update.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
      id: "rec_1",
      ...data,
    }));
    mocks.getPreset.mockReturnValue({ type: "nginx-config" });
    mocks.generateRemoteBackupPath.mockReturnValue("/tmp/vch-backup_test.tar.gz");
    mocks.buildRemoteBackupCommand.mockReturnValue("tar czf /tmp/vch-backup_test.tar.gz /etc/nginx");
    mocks.buildRemoteCleanupCommand.mockReturnValue("rm -f /tmp/vch-backup_test.tar.gz");
    mocks.buildSshParamsFromServer.mockResolvedValue({
      host: "10.0.0.1",
      port: 22,
      username: "root",
      password: "secret",
    });
    // Default: remote cleanup / extra SSH legs succeed (failRecord best-effort uses .catch).
    mocks.execRemoteCommand.mockResolvedValue({ stdout: "", stderr: "", exitCode: 0 });
  });

  it("fails when remote SSH exitCode is null (connection failure)", async () => {
    mocks.execRemoteCommand.mockResolvedValueOnce({
      stdout: "",
      stderr: "Connection timed out",
      exitCode: null,
    });

    const result = await runVpsBackupRecord("rec_1");

    expect(result.success).toBe(false);
    expect(result.errorMessage).toMatch(/SSH connection failed/i);
    expect(mocks.downloadFile).not.toHaveBeenCalled();
    expect(mocks.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "rec_1", status: { in: ["PENDING", "RUNNING"] } },
        data: expect.objectContaining({ status: "FAILED" }),
      }),
    );
  });

  it("fails when remote SSH exitCode is non-zero", async () => {
    mocks.execRemoteCommand.mockResolvedValueOnce({
      stdout: "",
      stderr: "tar: Permission denied",
      exitCode: 1,
    });

    const result = await runVpsBackupRecord("rec_1");

    expect(result.success).toBe(false);
    expect(result.errorMessage).toMatch(/exit 1/);
    expect(mocks.downloadFile).not.toHaveBeenCalled();
  });

  it("fails when SFTP download pipeline errors (does not mark COMPLETED)", async () => {
    mocks.execRemoteCommand
      .mockResolvedValueOnce({ stdout: "ok", stderr: "", exitCode: 0 })
      .mockResolvedValue({ stdout: "", stderr: "", exitCode: 0 });

    const badStream = new Readable({
      read() {
        this.destroy(new Error("SFTP stream aborted"));
      },
    });
    mocks.downloadFile.mockResolvedValueOnce({ stream: badStream, size: 0 });

    const result = await runVpsBackupRecord("rec_1");

    expect(result.success).toBe(false);
    expect(result.errorMessage).toMatch(/SFTP stream aborted|aborted/i);
    // Must not have written COMPLETED
    const completedCalls = mocks.update.mock.calls.filter(
      (call) => call[0]?.data?.status === "COMPLETED",
    );
    expect(completedCalls).toHaveLength(0);
  });

  it("fails when local archive is empty/too small even if remote command exited 0", async () => {
    mocks.execRemoteCommand
      .mockResolvedValueOnce({ stdout: "ok", stderr: "", exitCode: 0 })
      .mockResolvedValue({ stdout: "", stderr: "", exitCode: 0 });

    const tiny = Buffer.from("x"); // far below 32-byte guard
    mocks.downloadFile.mockResolvedValueOnce({
      stream: Readable.from([tiny]),
      size: tiny.length,
    });

    const result = await runVpsBackupRecord("rec_1");
    expect(result.success).toBe(false);
    expect(result.errorMessage).toMatch(/empty or too small/i);
    const completedCalls = mocks.update.mock.calls.filter(
      (call) => call[0]?.data?.status === "COMPLETED",
    );
    expect(completedCalls).toHaveLength(0);
  });

  it("completes when remote backup + SFTP download succeed", async () => {
    mocks.execRemoteCommand
      .mockResolvedValueOnce({ stdout: "ok", stderr: "", exitCode: 0 })
      .mockResolvedValue({ stdout: "", stderr: "", exitCode: 0 });

    // >= 32 bytes so the empty-archive guard does not fire
    const payload = Buffer.alloc(64, 0x1f);
    mocks.downloadFile.mockResolvedValueOnce({
      stream: Readable.from([payload]),
      size: payload.length,
    });

    const result = await runVpsBackupRecord("rec_1");

    expect(result.success).toBe(true);
    expect(result.checksumSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(result.localPath).toMatch(/^storage\/vps-backups\/srv_1\//);
    // Completion is a status-guarded CAS (updateMany where status:RUNNING), never a
    // blind update-by-id — so a record the stale-RUNNING reaper already failed
    // cannot be resurrected back to COMPLETED by a late-finishing transfer.
    expect(mocks.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "rec_1", status: "RUNNING" },
        data: expect.objectContaining({ status: "COMPLETED", checksumSha256: result.checksumSha256 }),
      }),
    );
  });
});

describe("assertPortableVpsBackupPath", () => {
  it("rejects path traversal and absolute paths", () => {
    expect(() => assertPortableVpsBackupPath("../etc/passwd")).toThrow();
    expect(() => assertPortableVpsBackupPath("/tmp/x.tar.gz")).toThrow();
    expect(() => assertPortableVpsBackupPath("storage/other/x.tar.gz")).toThrow();
  });

  it("accepts expected layout", () => {
    expect(assertPortableVpsBackupPath("storage/vps-backups/srv/nginx-config-id.tar.gz")).toBe(
      "storage/vps-backups/srv/nginx-config-id.tar.gz",
    );
  });
});

describe("deleteVpsBackupRecord", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("refuses to delete RUNNING records", async () => {
    mocks.findUnique.mockResolvedValueOnce({
      localPath: "storage/vps-backups/srv_1/nginx-config-rec_1.tar.gz",
      status: "RUNNING",
    });
    // Service translations default to zh; assert on the ConflictError, not copy.
    await expect(deleteVpsBackupRecord("rec_1")).rejects.toThrow(ConflictError);
    expect(mocks.delete).not.toHaveBeenCalled();
  });

  it("deletes non-running records via deleteMany CAS", async () => {
    mocks.findUnique.mockResolvedValueOnce({
      localPath: null,
      status: "FAILED",
    });
    mocks.deleteMany.mockResolvedValueOnce({ count: 1 });
    await deleteVpsBackupRecord("rec_1");
    expect(mocks.deleteMany).toHaveBeenCalledWith({
      where: { id: "rec_1", status: { not: "RUNNING" } },
    });
  });
});

describe("retryPendingVpsOffsiteUploads", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("paginates beyond the oldest full batch", async () => {
    const firstPage = Array.from({ length: 100 }, (_, index) => ({
      id: `vps-${String(index).padStart(3, "0")}`,
    }));
    mocks.findMany
      .mockResolvedValueOnce(firstPage)
      .mockResolvedValueOnce([{ id: "vps-100" }]);
    mocks.findUnique.mockResolvedValue({
      id: "pending",
      status: "PENDING",
      localPath: null,
      offsiteKey: null,
    });

    const result = await retryPendingVpsOffsiteUploads();

    expect(result).toEqual({ observed: 101, uploaded: 0, failed: 0, skipped: 101 });
    expect(mocks.findMany).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ cursor: { id: "vps-099" }, skip: 1 }),
    );
  });
});

describe("uploadVpsBackupToOffsite", () => {
  it("streams with a 30-minute S3 budget instead of the 30s default", async () => {
    vi.clearAllMocks();
    offsiteMocks.constructedWith.length = 0;
    // Place the artifact under the same portable root the service resolves.
    const artifactRoot = resolvePath(config.storage.root || process.cwd());
    const localPath = "storage/vps-backups/srv_1/nginx-config-rec_to.tar.gz";
    const artifactPath = join(artifactRoot, localPath);
    mkdirSync(dirname(artifactPath), { recursive: true });
    writeFileSync(artifactPath, "artifact-bytes");
    try {
      mocks.findUnique.mockResolvedValueOnce({
        id: "rec_to",
        serverId: "srv_1",
        backupType: "nginx-config",
        status: "COMPLETED",
        localPath,
        offsiteKey: null,
      });
      offsiteMocks.loadConfig.mockResolvedValueOnce(ENABLE_OFFSITE_CONFIG);
      offsiteMocks.putFile.mockResolvedValueOnce({ etag: "etag-1" });

      const { uploadVpsBackupToOffsite } = await import("../vps-backup-service");
      const result = await uploadVpsBackupToOffsite("rec_to");

      expect(result).toMatchObject({ ok: true, skipped: false, key: "vps-backups/srv_1/nginx-config-rec_to.tar.gz" });
      // Regression: the default 30s AbortSignal budget aborted large-artifact
      // uploads mid-stream. The client must be built with the 30-minute
      // streaming allowance (same as the control-plane offsite uploader).
      expect(offsiteMocks.constructedWith).toHaveLength(1);
      expect(offsiteMocks.constructedWith[0]).toMatchObject({
        endpoint: "https://s3.example.com",
        timeoutMs: 30 * 60 * 1000,
      });
      expect(offsiteMocks.putFile).toHaveBeenCalledTimes(1);
    } finally {
      rmSync(artifactPath, { force: true });
    }
  });
});
