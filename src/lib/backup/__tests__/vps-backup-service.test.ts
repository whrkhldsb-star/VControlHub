import { describe, expect, it, vi, beforeEach } from "vitest";
import { Readable } from "node:stream";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

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

const { runVpsBackupRecord, assertPortableVpsBackupPath, deleteVpsBackupRecord } = await import("../vps-backup-service");

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
    expect(mocks.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "rec_1" },
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
    expect(mocks.update).toHaveBeenCalledWith(
      expect.objectContaining({
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
    await expect(deleteVpsBackupRecord("rec_1")).rejects.toThrow(/RUNNING/);
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
