import { createHash } from "node:crypto";
import { Server, utils } from "ssh2";

/**
 * In-process SSH server for terminal layout checks. On every PTY size it draws
 * a ruler exactly `cols` wide and a `BOTTOM-ROW-<rows>` marker on the last row,
 * and records the window it was given, so a spec can compare the remote PTY
 * with the grid on screen.
 */
export async function startFakeSshServer(options: { username: string; password: string }) {
	const keys = utils.generateKeyPairSync("ed25519");
	const pem = keys.private;
	const publicBlob = Buffer.from(keys.public.trim().split(/\s+/)[1]!, "base64");
	const fingerprint = `SHA256:${createHash("sha256").update(publicBlob).digest("base64").replace(/=+$/, "")}`;
	const windows: Array<{ cols: number; rows: number }> = [];

	const clients = new Set<{ end: () => void }>();
	const server = new Server({ hostKeys: [pem] }, (client) => {
		clients.add(client);
		client.on("close", () => clients.delete(client));
		client.on("authentication", (ctx) => {
			if (ctx.method === "password" && ctx.username === options.username && ctx.password === options.password) ctx.accept();
			else ctx.reject(["password"]);
		}).on("ready", () => {
			client.on("session", (acceptSession) => {
				const session = acceptSession();
				let cols = 80;
				let rows = 24;
				let stream: { write: (data: string) => void; on: (event: string, listener: (data: Buffer) => void) => void } | null = null;
				const draw = () => {
					if (!stream) return;
					windows.push({ cols, rows });
					const ruler = Array.from({ length: cols }, (_, i) => ((i + 1) % 10 === 0 ? "|" : String((i + 1) % 10))).join("");
					// Ruler first, so it stays on row 0 even in a two-row grid.
					let out = `\x1b[2J\x1b[H${ruler}`;
					if (rows >= 3) out += `\r\nPTY ${cols}x${rows}`;
					for (let row = 3; row < rows; row += 1) out += `\r\nrow ${String(row).padStart(3, "0")}`;
					out += `\r\nBOTTOM-ROW-${rows} $ `;
					stream.write(out);
				};
				session.on("pty", (accept, _reject, info) => { cols = info.cols; rows = info.rows; accept?.(); });
				session.on("window-change", (accept, _reject, info) => { cols = info.cols; rows = info.rows; accept?.(); draw(); });
				session.on("env", (accept) => accept?.());
				session.on("shell", (accept) => { stream = accept(); draw(); stream.on("data", (data) => stream?.write(data.toString())); });
				session.on("exec", (accept) => { const channel = accept(); channel.exit(0); channel.end(); });
			});
		}).on("error", () => undefined);
	});
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	const address = server.address();
	const port = typeof address === "object" && address ? address.port : 0;
	// The proxy may keep a detached shell open; end client connections so
	// close() does not wait for them.
	const close = () => new Promise<void>((resolve) => {
		for (const client of clients) client.end();
		server.close(() => resolve());
	});
	return { port, fingerprint, windows, close };
}
