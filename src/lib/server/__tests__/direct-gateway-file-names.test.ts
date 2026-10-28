// @vitest-environment node
import { spawn, type ChildProcess } from "node:child_process";
import { createHmac } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
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
		for (const [name, body] of [["report%20.txt", "percent"], ["report .txt", "space"], ["report.txt#v2", "hash"], ["report.txt", "plain"]]) {
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

	async function download(name: string) {
		const expires = String(Math.floor(Date.now() / 1000) + 300);
		const signature = createHmac("sha256", secret).update(`/${name}.${expires}`).digest("hex");
		const response = await fetch(`http://127.0.0.1:${port}/${encodeURIComponent(name)}?expires=${expires}&signature=${signature}`);
		return { status: response.status, body: await response.text() };
	}

	function signedPath(name: string) {
		const expires = String(Math.floor(Date.now() / 1000) + 300);
		const signature = createHmac("sha256", secret).update(`/${name}.${expires}`).digest("hex");
		return `/${encodeURIComponent(name)}?expires=${expires}&signature=${signature}`;
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
		const signature = createHmac("sha256", secret).update(`/report.txt.${expires}`).digest("hex");
		const response = await fetch(`http://127.0.0.1:${port}/report.txt?expires=${expires}&signature=${signature}`);
		expect(response.status).toBe(403);
		const day = String(Math.floor(Date.now() / 1000) + 86400);
		const ok = createHmac("sha256", secret).update(`/report.txt.${day}`).digest("hex");
		expect((await fetch(`http://127.0.0.1:${port}/report.txt?expires=${day}&signature=${ok}`)).status).toBe(200);
	});

	it.each([
		["report%20.txt", "percent"],
		["report.txt#v2", "hash"],
		["report .txt", "space"],
		["report.txt", "plain"],
	])("serves %s itself", async (name, body) => {
		expect(await download(name)).toEqual({ status: 200, body });
	});
});
