import { Readable, PassThrough } from "node:stream";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  createWriteStreamMock,
  sftpEndMock,
  clientEndMock,
  connectMock,
  findUniqueMock,
} = vi.hoisted(() => ({
  createWriteStreamMock: vi.fn(),
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
        end: sftpEndMock,
      });
    }
  }
  return { Client };
});

vi.mock("@/lib/ssh/client", () => ({
  createVerifiedSshConfig: (input: Record<string, unknown>) => input,
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

vi.mock("@/lib/ssh/ssh-key-crypto", () => ({
  decryptServerPassword: (v: string) => v,
  decryptSshPrivateKey: (v: string) => v,
  decryptSshKeyPassphrase: (v: string) => v,
}));

import {
  sanitizeRemotePath,
  sanitizeFileName,
  uploadFile,
} from "@/lib/ssh/sftp-service";

describe("sanitizeRemotePath", () => {
  it("normalises consecutive slashes", () => {
    expect(sanitizeRemotePath("//root//home")).toBe("/root/home");
    expect(sanitizeRemotePath("/root///file.txt")).toBe("/root/file.txt");
  });

  it("rejects empty string", () => {
    expect(() => sanitizeRemotePath("")).toThrow("non-empty");
  });

  it("rejects null bytes", () => {
    expect(() => sanitizeRemotePath("/root\0/evil")).toThrow("null bytes");
  });

  it("rejects paths exceeding 4096 chars", () => {
    expect(() => sanitizeRemotePath("/" + "a".repeat(4097))).toThrow("maximum length");
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
    expect(() => sanitizeFileName("")).toThrow("non-empty");
  });

  it("rejects path separators", () => {
    expect(() => sanitizeFileName("foo/bar")).toThrow("Invalid filename");
    expect(() => sanitizeFileName("foo\\..\\bar")).toThrow("Invalid filename");
  });

  it("rejects null bytes", () => {
    expect(() => sanitizeFileName("file\0.txt")).toThrow("Invalid filename");
  });

  it("rejects names exceeding 255 chars", () => {
    expect(() => sanitizeFileName("a".repeat(256))).toThrow("maximum length");
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
      host: "10.0.0.1",
      port: 22,
      username: "alice",
      enabled: true,
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
    await expect(uploadPromise).rejects.toThrow("Upload write error");
    expect(sftpEndMock).toHaveBeenCalled();
    expect(clientEndMock).toHaveBeenCalled();
  });
});
