import { createHash } from "node:crypto";
import { Server, utils } from "ssh2";

/**
 * In-process SSH server whose shell behaves like a line editor: it echoes
 * typed bytes with control characters made visible (ESC as `^[`, the way
 * bash shows an unbound escape sequence), records every byte it receives, and
 * runs a few commands that imitate what full-screen programs do to a terminal.
 *
 *   tui       switch to the alternate screen and enable mouse tracking
 *             (1000/1002/1003 + SGR 1006), focus reports and bracketed paste,
 *             and hide the cursor, like Codex and Claude Code
 *   tui-exit  undo all of that, like a program that exits cleanly
 *   seq       print 120 numbered lines (scrollback for wheel checks)
 *   drop      end the whole SSH connection, like a gateway restart
 *   exit      end the shell with exit status 0, like typing `exit`
 *
 * Each shell gets its own prompt number (`lab-shell-<n>$`), so a spec can see
 * whether a reconnect continued the old shell or started a new one.
 */
export type ScriptedShell = {
	/** Every byte the shell received, latin1-decoded. */
	received: string;
	number: number;
};

const TUI_ON = "\x1b[?1049h\x1b[H\x1b[2J\x1b[?1000h\x1b[?1002h\x1b[?1003h\x1b[?1006h\x1b[?1004h\x1b[?2004h\x1b[?25lTUI-RUNNING";
const TUI_OFF = "\x1b[?1006l\x1b[?1003l\x1b[?1002l\x1b[?1000l\x1b[?1004l\x1b[?2004l\x1b[?25h\x1b[?1049l";

function visible(ch: string): string {
	const code = ch.charCodeAt(0);
	if (code === 0x1b) return "^[";
	if (code < 0x20) return `^${String.fromCharCode(code + 0x40)}`;
	return ch;
}

/** ssh2 occasionally rejects a key it just generated ("Malformed OpenSSH private key"): retry. */
function generateHostKey() {
	for (let attempt = 1; ; attempt += 1) {
		const keys = utils.generateKeyPairSync("ed25519");
		try {
			new Server({ hostKeys: [keys.private] }, () => undefined).close();
			return keys;
		} catch (error) {
			if (attempt >= 5) throw error;
		}
	}
}

export async function startScriptedSshServer(options: { username: string; password: string }) {
	const keys = generateHostKey();
	const publicBlob = Buffer.from(keys.public.trim().split(/\s+/)[1]!, "base64");
	const fingerprint = `SHA256:${createHash("sha256").update(publicBlob).digest("base64").replace(/=+$/, "")}`;
	const shells: ScriptedShell[] = [];
	const clients = new Set<{ end: () => void }>();

	const server = new Server({ hostKeys: [keys.private] }, (client) => {
		clients.add(client);
		client.on("close", () => clients.delete(client));
		client.on("authentication", (ctx) => {
			if (ctx.method === "password" && ctx.username === options.username && ctx.password === options.password) ctx.accept();
			else ctx.reject(["password"]);
		}).on("ready", () => {
			client.on("session", (acceptSession) => {
				const session = acceptSession();
				// Only the browser terminal asks for a PTY. The app's own health
				// probe also connects; its sessions must not count as shells.
				let interactive = false;
				session.on("pty", (accept) => { interactive = true; accept?.(); });
				session.on("window-change", (accept) => accept?.());
				session.on("env", (accept) => accept?.());
				session.on("exec", (accept) => { const channel = accept(); channel.exit(0); channel.end(); });
				session.on("shell", (accept) => {
					const stream = accept();
					if (!interactive) { stream.exit(0); stream.end(); return; }
					const shell: ScriptedShell = { received: "", number: shells.length + 1 };
					shells.push(shell);
					const prompt = () => `lab-shell-${shell.number}$ `;
					stream.write(`welcome to scripted shell ${shell.number}\r\n${prompt()}`);
					let line = "";
					let fullScreen = false;
					const run = (command: string) => {
						if (command === "tui") { fullScreen = true; stream.write(`\r\n${TUI_ON}`); }
						else if (command === "tui-exit") { fullScreen = false; stream.write(`${TUI_OFF}\r\n${prompt()}`); }
						else if (command === "seq") {
							let out = "\r\n";
							for (let index = 1; index <= 120; index += 1) out += `line ${String(index).padStart(3, "0")}\r\n`;
							stream.write(out + prompt());
						} else if (command === "drop") client.end();
						else if (command === "exit") { stream.write("\r\nlogout\r\n"); stream.exit(0); stream.end(); }
						else stream.write(`\r\n${prompt()}`);
					};
					stream.on("data", (chunk: Buffer) => {
						const text = chunk.toString("latin1");
						shell.received += text;
						// A full-screen program consumes escape sequences (mouse and
						// focus reports) and draws its own screen: nothing is echoed
						// and the reports do not become part of a command line. A
						// plain shell prints them as a line editor would (`^[[<…`).
						const keys = text.replace(/\x1b\[[0-9;<?]*[A-Za-z~]|\x1b[^[]/g, "");
						if (!fullScreen) for (const ch of text) if (ch !== "\r" && ch !== "\x7f") stream.write(visible(ch));
						for (const ch of keys) {
							if (ch === "\r") { const command = line; line = ""; run(command); continue; }
							if (ch === "\x7f") { if (line) { line = line.slice(0, -1); if (!fullScreen) stream.write("\b \b"); } continue; }
							if (ch >= " ") line += ch;
						}
					});
				});
			});
		}).on("error", () => undefined);
	});
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	const address = server.address();
	const port = typeof address === "object" && address ? address.port : 0;
	const close = () => new Promise<void>((resolve) => {
		for (const client of clients) client.end();
		server.close(() => resolve());
	});
	return { port, fingerprint, shells, close };
}

/** Mouse reports (SGR and legacy X10 encodings) and focus reports in shell input. */
export function countTerminalReports(input: string): { mouse: number; focus: number } {
	const mouse = (input.match(/\x1b\[<\d+;\d+;\d+[Mm]/g)?.length ?? 0) + (input.match(/\x1b\[M[\s\S]{3}/g)?.length ?? 0);
	const focus = input.match(/\x1b\[[IO]/g)?.length ?? 0;
	return { mouse, focus };
}
