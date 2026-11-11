import { Readable, PassThrough } from "node:stream";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  createWriteStreamMock,
  createReadStreamMock,
  statMock,
  sftpEndMock,
  clientEndMock,
  connectMock,
  findUniqueMock,
} = vi.hoisted(() => ({
  createWriteStreamMock: vi.fn(),
  createReadStreamMock: vi.fn(),
  statMock: vi.fn(),
  sftpEndMock: vi.fn(),
  clientEndMock: vi.fn(),
  connectMock: vi.fn(),
  findUniqueMock: vi.fn(),
}));

vi.mock("ssh2", () => {
  class Client {
    #handlers = new Map<string, Array<(...args: unknown[]) => void>>();

    on(event: string, cb: (...args: unknown[]) => void) {
      const list = this.#handlers.get(event) ?? [];
      list.push(cb);
      this.#handlers.set(event, list);
      return this;
    }

    connect(config: unknown) {
      connectMock(config);
      // Fire ready asynchronously after connect (matches ssh2 ordering).
      queueMicrotask(() => {
        for (const cb of this.#handlers.get("ready") ?? []) cb();
      });
      return this;
    }

    end() {
      clientEndMock();
    }

    sftp(cb: (err: Error | null, sftp: unknown) => void) {
      cb(null, {
        createWriteStream: createWriteStreamMock,
        createReadStream: createReadStreamMock,
        stat: statMock,
        end: sftpEndMock,
      });
    }
  }
  return { Client };
});

vi.mock("@/lib/ssh/client", () => ({
  createVerifiedSshConfig: (input: Record<string, unknown>) => input,
  // Mirrors production credential selection without touching crypto: the
  // crypto module is separately mocked to identity below.
  buildSshParamsFromServer: async (
    server: Record<string, unknown>,
    sshKey?: { privateKey?: string | null; passphrase?: string | null } | null,
  ) => ({
    host: server.host,
    port: server.port,
    username: server.username,
    hostKeySha256: server.hostKeySha256 ?? null,
    ...(server.connectionType === "SSH_KEY" && sshKey?.privateKey
      ? {
          privateKey: sshKey.privateKey,
          ...(sshKey.passphrase ? { passphrase: sshKey.passphrase } : {}),
        }
      : {}),
    ...(server.connectionType === "PASSWORD" && server.password
      ? { password: server.password }
      : {}),
  }),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    server: {
      findUnique: findUniqueMock,
    },
  },
}));

vi.mock("@/lib/logging", () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

vi.mock("@/lib/ssh/ssh-key-crypto", async () => (await import("@/test/ssh-key-crypto-mock")).withStoredKeyHelpers({
  decryptServerPassword: (v: string) => v,
  decryptSshPrivateKey: (v: string) => v,
  decryptSshKeyPassphrase: (v: string) => v,
}));

import {
  sanitizeRemotePath,
  sanitizeFileName,
  uploadFile,
  downloadFile,
} from "@/lib/ssh/sftp-service";

describe("sanitizeRemotePath", () => {
  it("normalises consecutive slashes", () => {
    expect(sanitizeRemotePath("//root//home")).toBe("/root/home");
    expect(sanitizeRemotePath("/root///file.txt")).toBe("/root/file.txt");
  });

  it("rejects empty string", () => {
    expect(() => sanitizeRemotePath("")).toThrow("路径不能为空");
  });

  it("rejects null bytes", () => {
    expect(() => sanitizeRemotePath("/root\0/evil")).toThrow("路径包含空字节");
  });

  it("rejects paths exceeding 4096 chars", () => {
    expect(() => sanitizeRemotePath("/" + "a".repeat(4097))).toThrow("路径过长");
  });

  it("refuses a bad path or name as invalid input, in the caller's language", async () => {
    // Plain Errors: the request answered 500 "operation failed" for what the
    // caller sent (a name with a backslash, a path past the limit).
    const { ValidationError } = await import("@/lib/errors");
    const { withApiCopyLocale } = await import("@/lib/i18n/api-copy");
    for (const refuse of [
      () => sanitizeRemotePath(""),
      () => sanitizeRemotePath("/root\0/evil"),
      () => sanitizeRemotePath("/" + "a".repeat(4097)),
      () => sanitizeFileName(""),
      () => sanitizeFileName("foo\\bar"),
      () => sanitizeFileName("a".repeat(256)),
    ]) {
      expect(refuse).toThrow(ValidationError);
      expect(() => withApiCopyLocale("en", refuse)).toThrow(/^[\x20-\x7e]+$/);
    }
  });

  it("accepts standard absolute paths", () => {
    expect(sanitizeRemotePath("/root/.bashrc")).toBe("/root/.bashrc");
    expect(sanitizeRemotePath("/var/log/nginx/access.log")).toBe("/var/log/nginx/access.log");
  });

  it("accepts relative paths", () => {
    expect(sanitizeRemotePath("./foo/bar")).toBe("./foo/bar");
    expect(sanitizeRemotePath("~/documents")).toBe("~/documents");
  });
});

describe("sanitizeFileName", () => {
  it("rejects empty string", () => {
    expect(() => sanitizeFileName("")).toThrow("文件名不能为空");
  });

  it("rejects path separators", () => {
    expect(() => sanitizeFileName("foo/bar")).toThrow("文件名不能包含路径分隔符或空字节");
    expect(() => sanitizeFileName("foo\\..\\bar")).toThrow("文件名不能包含路径分隔符或空字节");
    expect(() => sanitizeFileName("foo\\bar")).toThrow("文件名不能包含路径分隔符或空字节");
  });

  it("rejects . and .. as whole-segment traversal names", () => {
    expect(() => sanitizeFileName(".")).toThrow("文件名不能包含路径分隔符或空字节");
    expect(() => sanitizeFileName("..")).toThrow("文件名不能包含路径分隔符或空字节");
  });

  it("accepts legitimate filenames that merely contain '..' as a substring", () => {
    // Path separators are already rejected, so a substring ".." cannot form a
    // traversal segment. Names like these are valid and must not be rejected.
    expect(sanitizeFileName("foo..bar")).toBe("foo..bar");
    expect(sanitizeFileName("photo..jpg")).toBe("photo..jpg");
    expect(sanitizeFileName("版本..备份.zip")).toBe("版本..备份.zip");
  });

  it("rejects null bytes", () => {
    expect(() => sanitizeFileName("file\0.txt")).toThrow("文件名不能包含路径分隔符或空字节");
  });

  it("rejects names exceeding 255 chars", () => {
    expect(() => sanitizeFileName("a".repeat(256))).toThrow("文件名过长");
  });

  it("accepts valid filenames", () => {
    expect(sanitizeFileName("backup.tar.gz")).toBe("backup.tar.gz");
    expect(sanitizeFileName(".bashrc")).toBe(".bashrc");
    expect(sanitizeFileName("my-file_v2.txt")).toBe("my-file_v2.txt");
  });
});

describe("uploadFile session lifecycle", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    findUniqueMock.mockResolvedValue({
      id: "srv1",
      name: "srv1",
      host: "10.0.0.1",
      port: 22,
      username: "alice",
      enabled: true,
      operatingSystem: "LINUX",
      managementMode: "DIRECT",
      sshKeyId: null,
      connectionType: "PASSWORD",
      password: "secret",
      hostKeySha256: "SHA256:pin",
      sshKey: null,
    });
  });

  it("closes the SSH/SFTP session after a successful upload", async () => {
    const writeStream = new PassThrough();
    createWriteStreamMock.mockReturnValue(writeStream);

    const source = Readable.from([Buffer.from("hello-upload")]);
    await expect(uploadFile("srv1", "/home/alice/out.txt", source)).resolves.toBe(
      Buffer.byteLength("hello-upload"),
    );
    expect(sftpEndMock).toHaveBeenCalled();
    expect(clientEndMock).toHaveBeenCalled();
  });

  it("opens the SFTP session with fail-closed host-key pinning (enforceHostKeyPin)", async () => {
    // The fixture server has no hostKeySha256 pin; the session config must
    // still request enforcement so an unpinned host key fails the handshake
    // instead of being silently accepted (parity with command execution).
    const writeStream = new PassThrough();
    createWriteStreamMock.mockReturnValue(writeStream);

    const source = Readable.from([Buffer.from("hello-upload")]);
    await uploadFile("srv1", "/home/alice/out.txt", source);

    expect(connectMock).toHaveBeenCalledWith(expect.objectContaining({ enforceHostKeyPin: true }));
  });

  it("closes the SSH/SFTP session when the write stream errors", async () => {
    const writeStream = new PassThrough();
    // Prevent unhandled 'error' if destroy races slightly ahead of listeners.
    writeStream.on("error", () => {
      /* swallowed by uploadFile handler */
    });
    createWriteStreamMock.mockReturnValue(writeStream);

    const source = new Readable({
      read() {
        this.push(Buffer.from("chunk"));
      },
    });
    // Avoid unhandled source errors after destroy.
    source.on("error", () => {
      /* expected after fail() */
    });

    const uploadPromise = uploadFile("srv1", "/home/alice/out.txt", source);
    // Wait until createWriteStream has been used (session open + pipe started).
    await vi.waitFor(() => {
      expect(createWriteStreamMock).toHaveBeenCalled();
    });
    writeStream.destroy(new Error("disk full"));
    await expect(uploadPromise).rejects.toThrow("disk full");
    expect(sftpEndMock).toHaveBeenCalled();
    expect(clientEndMock).toHaveBeenCalled();
  });

  it.each([
    ["No such file", 2, 404],
    ["Permission denied", 3, 403],
    ["No space left on device", 4, 422],
    ["Failure", 4, 502],
  ])("reports a refused write (%s) with its own status instead of a plain Error", async (message, code, status) => {
    const writeStream = new PassThrough();
    writeStream.on("error", () => {
      /* swallowed by uploadFile handler */
    });
    createWriteStreamMock.mockReturnValue(writeStream);
    const source = new Readable({
      read() {
        this.push(Buffer.from("chunk"));
      },
    });
    source.on("error", () => {
      /* expected after fail() */
    });

    const uploadPromise = uploadFile("srv1", "/home/alice/missing/out.txt", source);
    await vi.waitFor(() => {
      expect(createWriteStreamMock).toHaveBeenCalled();
    });
    writeStream.destroy(Object.assign(new Error(message), { code }));

    // The route passes a typed error through; a plain Error became a blank "Upload failed" 500.
    await expect(uploadPromise).rejects.toMatchObject({ message, status });
    expect(sftpEndMock).toHaveBeenCalled();
    expect(clientEndMock).toHaveBeenCalled();
  });
});

describe("downloadFile session lifecycle", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    findUniqueMock.mockResolvedValue({
      id: "srv1",
      name: "srv1",
      host: "10.0.0.1",
      port: 22,
      username: "alice",
      enabled: true,
      operatingSystem: "LINUX",
      managementMode: "DIRECT",
      sshKeyId: null,
      connectionType: "PASSWORD",
      password: "secret",
      hostKeySha256: "SHA256:pin",
      sshKey: null,
    });
    statMock.mockImplementation(
      (_path: string, cb: (err: Error | null, stats: unknown) => void) => {
        cb(null, { isDirectory: () => false, size: 12 });
      },
    );
  });

  it("closes the SSH/SFTP session after the read stream finishes", async () => {
    const readStream = new PassThrough();
    createReadStreamMock.mockReturnValue(readStream);

    const { stream, size } = await downloadFile("srv1", "/home/alice/in.txt");
    expect(size).toBe(12);

    // Drain the returned stream, then let the remote read stream end normally.
    stream.resume();
    readStream.end(Buffer.from("hello-remote"));

    await vi.waitFor(() => {
      expect(clientEndMock).toHaveBeenCalled();
    });
  });

  it("tears the session down (and destroys the read stream) when the consumer aborts", async () => {
    const readStream = new PassThrough();
    readStream.on("error", () => {
      /* expected once destroyed */
    });
    createReadStreamMock.mockReturnValue(readStream);

    const { stream } = await downloadFile("srv1", "/home/alice/in.txt");
    // Simulate an HTTP client disconnect: the consumer destroys the passthrough
    // before the read completes. .pipe() would otherwise leave readStream (and
    // thus the SSH session) open.
    stream.destroy();

    await vi.waitFor(() => {
      expect(readStream.destroyed).toBe(true);
      expect(clientEndMock).toHaveBeenCalled();
    });
  });

  it("refuses a folder as a 400 the user can read, closing the session", async () => {
    statMock.mockImplementation((_path: string, cb: (err: Error | null, stats: unknown) => void) => {
      cb(null, { isDirectory: () => true, size: 4096 });
    });

    await expect(downloadFile("srv1", "/home/alice/projects")).rejects.toMatchObject({ status: 400 });
    expect(createReadStreamMock).not.toHaveBeenCalled();
    expect(clientEndMock).toHaveBeenCalled();
  });

  it("reports a file that is gone as not found, not a server failure", async () => {
    statMock.mockImplementation((_path: string, cb: (err: Error | null, stats: unknown) => void) => {
      cb(Object.assign(new Error("No such file"), { code: 2 }), undefined);
    });

    await expect(downloadFile("srv1", "/home/alice/gone.txt")).rejects.toMatchObject({ status: 404 });
    expect(clientEndMock).toHaveBeenCalled();
  });

  it("closes the session when the read stream errors", async () => {
    const readStream = new PassThrough();
    readStream.on("error", () => {
      /* handled by downloadFile */
    });
    createReadStreamMock.mockReturnValue(readStream);

    const { stream } = await downloadFile("srv1", "/home/alice/in.txt");
    stream.on("error", () => {
      /* expected: error propagates to the consumer */
    });
    readStream.destroy(new Error("remote read failed"));

    await vi.waitFor(() => {
      expect(clientEndMock).toHaveBeenCalled();
    });
  });
});
