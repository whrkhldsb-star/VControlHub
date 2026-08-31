import { PassThrough, Readable } from "node:stream";

import { describe, expect, it, vi } from "vitest";

/**
 * Tests for the tar.gz archive streaming helpers.
 *
 * `safeArchiveName` sits on the **public share-link** download path
 * (`/api/share/[token]`), where the name comes from a share record an
 * unauthenticated visitor can reach. It is what keeps a crafted folder name out
 * of the `Content-Disposition` header, so its sanitising is covered here in
 * detail: separators, CR/LF (header injection), quotes, and the empty result.
 *
 * The streaming helpers each own one cleanup rule. `streamLocalTarGz` overrides
 * `stdout.destroy` so a cancelled download kills the `tar` child — otherwise an
 * aborted browser request leaves an orphan tar/gzip pair running on the host.
 * `closeSshClientOnStreamEnd` must end the SSH client exactly once across the
 * three events it listens to, since `close`, `end` and `error` frequently all
 * fire for the same transfer.
 */
const mocks = vi.hoisted(() => {
	return {
		spawn: vi.fn(),
		lastChild: null as null | (import("node:stream").PassThrough & {
			stdout: import("node:stream").PassThrough;
			stderr: import("node:stream").PassThrough;
			kill: ReturnType<typeof vi.fn>;
			exitCode: number | null;
			signalCode: string | null;
			killed: boolean;
		}),
	};
});

// Both specifier forms are mocked: Vitest resolves `node:child_process` and the
// bare `child_process` to separate module entries, and mocking only the prefixed
// one leaves the real `spawn` in place.
vi.mock("node:child_process", async (importOriginal) => {
	const actual = await importOriginal<typeof import("node:child_process")>();
	return { ...actual, spawn: mocks.spawn, default: { ...actual, spawn: mocks.spawn } };
});
vi.mock("child_process", async (importOriginal) => {
	const actual = await importOriginal<typeof import("child_process")>();
	return { ...actual, spawn: mocks.spawn, default: { ...actual, spawn: mocks.spawn } };
});

/**
 * Re-install the fake child. `mockClear()` only drops call records, but the
 * implementation has to be re-seeded whenever a test resets the mock, so every
 * case calls this instead of clearing directly.
 */
function armSpawn() {
	mocks.spawn.mockReset();
	mocks.spawn.mockImplementation(() => {
		const child = new PassThrough() as never as NonNullable<typeof mocks.lastChild>;
		child.stdout = new PassThrough();
		child.stderr = new PassThrough();
		child.kill = vi.fn();
		child.exitCode = null;
		child.signalCode = null;
		child.killed = false;
		mocks.lastChild = child;
		return child;
	});
}

import {
	archiveStreamResponse,
	buildArchiveHeaders,
	closeSshClientOnStreamEnd,
	safeArchiveName,
	streamLocalTarGz,
} from "../archive-stream";

describe("safeArchiveName", () => {
	it("appends .tar.gz to an ordinary folder name", () => {
		expect(safeArchiveName("reports")).toBe("reports.tar.gz");
	});

	it("keeps CJK characters, which the header encoder handles", () => {
		expect(safeArchiveName("年度报告")).toBe("年度报告.tar.gz");
	});

	it("strips path separators so only a basename survives", () => {
		expect(safeArchiveName("/etc/passwd")).toBe("passwd.tar.gz");
		expect(safeArchiveName("a/b/c")).toBe("c.tar.gz");
	});

	it("collapses characters that could break out of the header value", () => {
		// A raw CR/LF in Content-Disposition is response-header injection, and the
		// name reaches this function from a publicly reachable share record.
		const name = safeArchiveName('evil"\r\nX-Injected: 1');
		expect(name).not.toContain("\r");
		expect(name).not.toContain("\n");
		expect(name).not.toContain('"');
	});

	it("replaces runs of unsafe characters with a single hyphen", () => {
		expect(safeArchiveName("a  ***  b")).toBe("a-b.tar.gz");
	});

	it("preserves dots, hyphens and underscores", () => {
		expect(safeArchiveName("my_backup-v1.2")).toBe("my_backup-v1.2.tar.gz");
	});

	it("falls back to 'folder' when the basename is empty", () => {
		// Without the fallback the download would be served as a bare ".tar.gz".
		expect(safeArchiveName("///")).toBe("folder.tar.gz");
		expect(safeArchiveName("")).toBe("folder.tar.gz");
	});

	it("yields a hyphen, not the fallback, for an all-unsafe basename", () => {
		// The fallback only fires on an *empty* result, and the replacement leaves a
		// single hyphen behind. Ugly but safe, and pinned so the distinction from
		// the empty case above is deliberate.
		expect(safeArchiveName("***")).toBe("-.tar.gz");
	});
});

describe("buildArchiveHeaders", () => {
	it("declares gzip and forbids caching", () => {
		// Share archives can contain private data; a shared cache must not keep them.
		const headers = buildArchiveHeaders("reports.tar.gz");
		expect(headers.get("content-type")).toBe("application/gzip");
		expect(headers.get("cache-control")).toBe("private, no-store");
	});

	it("sets an attachment disposition carrying the filename", () => {
		const headers = buildArchiveHeaders("reports.tar.gz");
		const disposition = headers.get("content-disposition")!;
		expect(disposition).toContain("attachment");
		expect(disposition).toContain('filename="reports.tar.gz"');
	});

	it("adds the RFC 5987 form for a non-ASCII filename", () => {
		const disposition = buildArchiveHeaders("年度报告.tar.gz").get("content-disposition")!;
		expect(disposition).toContain("filename*=UTF-8''");
	});
});

describe("archiveStreamResponse", () => {
	it("returns a 200 whose body streams the archive", async () => {
		const response = archiveStreamResponse(Readable.from([Buffer.from("tar-bytes")]), "a.tar.gz");
		expect(response.status).toBe(200);
		expect(response.headers.get("content-type")).toBe("application/gzip");
		await expect(response.text()).resolves.toBe("tar-bytes");
	});
});

describe("streamLocalTarGz", () => {
	it("spawns tar with argv arguments and a -- separator", () => {
		// argv form plus `--` means a folder named "-C" or "--checkpoint-action"
		// cannot be reinterpreted as a tar option.
		armSpawn();
		streamLocalTarGz("/srv/data/reports", "reports");
		expect(mocks.spawn).toHaveBeenCalledWith(
			"tar",
			["-czf", "-", "-C", "/srv/data", "--", "reports"],
			{ stdio: ["ignore", "pipe", "pipe"] },
		);
	});

	it("kills the tar child when the response stream is cancelled", () => {
		// An aborted browser download otherwise leaves orphan tar/gzip processes on
		// the host — the reason `stdout.destroy` is wrapped at all.
		armSpawn();
		const stream = streamLocalTarGz("/srv/data/reports", "reports");
		const child = mocks.lastChild!;
		stream.destroy?.();
		expect(child.kill).toHaveBeenCalledWith("SIGTERM");
	});

	it("does not signal a child that has already exited", () => {
		armSpawn();
		const stream = streamLocalTarGz("/srv/data/reports", "reports");
		const child = mocks.lastChild!;
		child.exitCode = 0;
		stream.destroy?.();
		expect(child.kill).not.toHaveBeenCalled();
	});

	it("errors the stream when tar exits non-zero", async () => {
		armSpawn();
		const stream = streamLocalTarGz("/srv/data/reports", "reports");
		const child = mocks.lastChild!;
		const failure = new Promise<Error>((resolve) => stream.once("error", resolve));
		child.emit("close", 2, null);
		const error = await failure;
		expect(error).toBeInstanceOf(Error);
		expect(error.message).toMatch(/code 2/);
	});

	it("errors the stream when tar is killed by a signal", async () => {
		armSpawn();
		const stream = streamLocalTarGz("/srv/data/reports", "reports");
		const child = mocks.lastChild!;
		const failure = new Promise<Error>((resolve) => stream.once("error", resolve));
		// Exit code null + a signal is how an OOM kill or SIGTERM surfaces; without
		// this branch the archive would end early and look like a complete download.
		child.emit("close", null, "SIGKILL");
		expect((await failure).message).toMatch(/SIGKILL/);
	});

	it("does not error the stream on a clean exit", () => {
		armSpawn();
		const stream = streamLocalTarGz("/srv/data/reports", "reports");
		const child = mocks.lastChild!;
		const onError = vi.fn();
		stream.on("error", onError);
		child.emit("close", 0, null);
		expect(onError).not.toHaveBeenCalled();
	});
});

describe("closeSshClientOnStreamEnd", () => {
	function fakeClient() {
		return { end: vi.fn() };
	}

	it("ends the client when the stream closes", () => {
		const stream = Readable.from([Buffer.from("x")]);
		const client = fakeClient();
		closeSshClientOnStreamEnd(stream, client as never);
		stream.emit("close");
		expect(client.end).toHaveBeenCalledTimes(1);
	});

	it("ends the client on error too, so a failed transfer does not leak the connection", () => {
		const stream = new Readable({ read() {} });
		const client = fakeClient();
		closeSshClientOnStreamEnd(stream, client as never);
		stream.emit("error", new Error("broken pipe"));
		expect(client.end).toHaveBeenCalledTimes(1);
	});

	it("ends the client exactly once when end, close and error all fire", () => {
		// All three routinely fire for one transfer; a second `end()` on an already
		// closed ssh2 client throws.
		const stream = new Readable({ read() {} });
		const client = fakeClient();
		closeSshClientOnStreamEnd(stream, client as never);
		stream.emit("end");
		stream.emit("close");
		stream.emit("error", new Error("late"));
		expect(client.end).toHaveBeenCalledTimes(1);
	});
});
