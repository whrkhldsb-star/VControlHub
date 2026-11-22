// @vitest-environment node
import { spawn, type ChildProcess } from "node:child_process";
import { createHmac } from "node:crypto";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { connect, createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { pythonGatewaySource } from "@/lib/server/direct-gateway";

/**
 * The Linux direct gateway serves the file named by the signed link, byte
 * for byte. It used to re-parse the decoded name as a URL: "report%20.txt"
 * served "report .txt" and "report.txt#v2" served "report.txt".
 */
const runnable = process.platform === "linux";
describe.skipIf(!runnable)("direct gateway file names", () => {
	const secret = "gateway-test-secret";
	let root = "";
	let port = 0;
	let gateway: ChildProcess | null = null;

	const freePort = () => new Promise<number>((resolve) => {
		const server = createServer();
		server.listen(0, "127.0.0.1", () => {
			const address = server.address();
			server.close(() => resolve(typeof address === "object" && address ? address.port : 0));
		});
	});

	beforeAll(async () => {
		root = await mkdtemp(path.join(tmpdir(), "vch-direct-names-"));
		for (const [name, body] of [["report%20.txt", "percent"], ["report;v2", "semicolon"], ["report .txt", "space"], ["report.txt#v2", "hash"], ["report.txt", "plain"]]) {
			await writeFile(path.join(root, name!), body!);
		}
		const script = path.join(root, "..", `${path.basename(root)}-gateway.py`);
		await writeFile(script, pythonGatewaySource());
		port = await freePort();
		gateway = spawn("python3", [script], { env: { ...process.env, DIRECT_ROOT: root, DIRECT_SECRET: secret, DIRECT_PORT: String(port) }, stdio: "ignore" });
		for (let attempt = 0; attempt < 50; attempt++) {
			const ok = await fetch(`http://127.0.0.1:${port}/__vch_health`).then((response) => response.ok, () => false);
			if (ok) return;
			await new Promise((resolve) => setTimeout(resolve, 100));
		}
		throw new Error("gateway did not start");
	});
	afterAll(async () => {
		gateway?.kill();
		if (root) {
			await rm(root, { recursive: true, force: true });
			await rm(`${root}-gateway.py`, { force: true });
		}
	});

	function signedPath(name: string, expires = String(Math.floor(Date.now() / 1000) + 300), nodeRoot = root) {
		const signature = createHmac("sha256", secret)
			.update(`linux-file-v1\0${nodeRoot}/${name}\0${expires}`)
			.digest("hex");
		const pathname = name.split("/").map(encodeURIComponent).join("/");
		return `/${pathname}?expires=${expires}&signature=${signature}`;
	}

	async function download(name: string) {
		const response = await fetch(`http://127.0.0.1:${port}${signedPath(name)}`);
		return { status: response.status, body: await response.text() };
	}

	/** The raw reply to a request, as written on the wire: fetch drops a HEAD body unseen. */
	function rawReply(method: string, target: string) {
		return new Promise<string>((resolve, reject) => {
			const socket = connect(port, "127.0.0.1", () => socket.write(`${method} ${target} HTTP/1.0\r\nHost: gateway\r\n\r\n`));
			const chunks: Buffer[] = [];
			socket.on("data", (chunk: Buffer) => chunks.push(chunk));
			socket.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
			socket.on("error", reject);
		});
	}

	it("answers HEAD with the headers alone", async () => {
		// do_HEAD ran do_GET, which wrote the whole file after the headers:
		// a downloader's HEAD transferred it once before the real download.
		const reply = await rawReply("HEAD", signedPath("report.txt"));
		const [head, body] = reply.split("\r\n\r\n");
		expect(head).toMatch(/^HTTP\/1\.[01] 200/);
		expect(head).toMatch(/Content-Length: 5/i);
		expect(body).toBe("");

		const health = await rawReply("HEAD", "/__vch_health");
		expect(health.split("\r\n\r\n")[1]).toBe("");
	});

	it("refuses a link whose expiry is further away than the hub ever signs", async () => {
		// A signature that never expires can only come from someone who holds the secret.
		const expires = String(Math.floor(Date.now() / 1000) + 10 * 86400);
		const response = await fetch(`http://127.0.0.1:${port}${signedPath("report.txt", expires)}`);
		expect(response.status).toBe(403);
		const day = String(Math.floor(Date.now() / 1000) + 86400);
		expect((await fetch(`http://127.0.0.1:${port}${signedPath("report.txt", day)}`)).status).toBe(200);
	});

	it("opens only regular files through real directory components", async () => {
		await mkdir(path.join(root, "nested"));
		await writeFile(path.join(root, "nested", "sample.txt"), "sample");
		await symlink("nested", path.join(root, "directory-link"));
		await symlink("sample.txt", path.join(root, "nested", "file-link"));
		expect(await download("nested/sample.txt")).toEqual({ status: 200, body: "sample" });
		for (const name of ["directory-link/sample.txt", "nested/file-link", "nested"]) {
			expect(await download(name)).toEqual({ status: 404, body: "not found" });
		}
	});

	it("keeps a literal semicolon in the final filename", async () => {
		const target = signedPath("report;v2").replace("%3B", ";");
		const result = await fetch(`http://127.0.0.1:${port}${target}`);
		expect(result.status).toBe(200);
		expect(await result.text()).toBe("semicolon");
	});

	it("requires the node and gateway to map the signed file to the same absolute path", async () => {
		const expires = String(Math.floor(Date.now() / 1000) + 300);
		const target = signedPath("report.txt", expires, `${root}/different-root`);
		const response = await fetch(`http://127.0.0.1:${port}${target}`, { method: "HEAD" });
		expect(response.status).toBe(403);
	});

	it("returns range metadata and bytes for the verified file", async () => {
		const response = await fetch(`http://127.0.0.1:${port}${signedPath("report.txt")}`, {
			headers: { Range: "bytes=1-3" },
		});
		expect(response.status).toBe(206);
		expect(response.headers.get("Content-Range")).toBe("bytes 1-3/5");
		expect(response.headers.get("X-VCH-File-Access")).toBe("linux-file-v1");
		expect(await response.text()).toBe("lai");
	});

	it.each([
		["report%20.txt", "percent"],
		["report.txt#v2", "hash"],
		["report .txt", "space"],
		["report.txt", "plain"],
	])("serves %s itself", async (name, body) => {
		expect(await download(name)).toEqual({ status: 200, body });
	});

	it("sends nosniff, referrer, sandbox CSP (except PDF), and forces attachment on active markup and ?download=1", async () => {
		await writeFile(path.join(root, "page.html"), "<script>alert(1)</script>");
		await writeFile(path.join(root, "vector.svg"), "<svg/>");
		await writeFile(path.join(root, "doc.pdf"), "%PDF-1.4");

		const html = await fetch(`http://127.0.0.1:${port}${signedPath("page.html")}`);
		expect(html.status).toBe(200);
		expect(html.headers.get("X-Content-Type-Options")).toBe("nosniff");
		expect(html.headers.get("Referrer-Policy")).toBe("no-referrer");
		expect(html.headers.get("Content-Security-Policy")).toBe("sandbox");
		expect(html.headers.get("Content-Disposition")).toBe("attachment");

		const svg = await fetch(`http://127.0.0.1:${port}${signedPath("vector.svg")}`);
		expect(svg.status).toBe(200);
		expect(svg.headers.get("Content-Security-Policy")).toBe("sandbox");
		expect(svg.headers.get("Content-Disposition")).toBe("attachment");

		const pdf = await fetch(`http://127.0.0.1:${port}${signedPath("doc.pdf")}`);
		expect(pdf.status).toBe(200);
		expect(pdf.headers.get("X-Content-Type-Options")).toBe("nosniff");
		expect(pdf.headers.get("Referrer-Policy")).toBe("no-referrer");
		expect(pdf.headers.get("Content-Security-Policy")).toBeNull();
		expect(pdf.headers.get("Content-Disposition")).toBeNull();

		const dl = await fetch(`http://127.0.0.1:${port}${signedPath("report.txt")}&download=1`);
		expect(dl.status).toBe(200);
		expect(dl.headers.get("Content-Security-Policy")).toBe("sandbox");
		expect(dl.headers.get("Content-Disposition")).toBe("attachment");
	});
});
