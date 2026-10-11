// @vitest-environment node
import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(__dirname, "../..");
const read = (file: string) => readFile(path.join(repoRoot, file), "utf8");

/** WebSocket paths the SSH WebSocket service accepts, read from its upgrade handler. */
async function gatewayWebSocketPaths() {
	const source = await read("src/ssh-ws-proxy.ts");
	const start = source.indexOf('server.on("upgrade"');
	expect(start, "upgrade handler in src/ssh-ws-proxy.ts").toBeGreaterThan(-1);
	const handler = source.slice(start, source.indexOf("});", start));
	return [...new Set([...handler.matchAll(/path [!=]== "(\/[a-z]+)"/g)].map((match) => match[1]!))];
}

describe("reverse-proxy templates", () => {
	it("reads the gateway paths from the upgrade handler", async () => {
		expect(await gatewayWebSocketPaths()).toEqual(expect.arrayContaining(["/ssh", "/rdp"]));
	});

	// install.sh and upgrade.sh re-render the whole Caddyfile, so a route missing
	// here is dropped from every installation on its next upgrade.
	it("routes every gateway WebSocket path in the Caddy template, over HTTP and HTTPS", async () => {
		const caddy = await read("deploy/Caddyfile.example");
		const routes = caddy.slice(caddy.indexOf("(vcontrolhub_routes) {"), caddy.indexOf("\n}\n", caddy.indexOf("(vcontrolhub_routes) {")));
		// 127.0.0.1:3001 is the placeholder install.sh rewrites to SSH_WS_HOST:SSH_WS_PORT.
		for (const route of await gatewayWebSocketPaths()) {
			expect(routes).toMatch(new RegExp(`^\\treverse_proxy ${route} 127\\.0\\.0\\.1:3001$`, "m"));
		}
		expect(caddy.match(/^\timport vcontrolhub_routes$/gm)).toHaveLength(2);
	});

	it("routes the direct gateway exactly as deploy.sh adds it to older Caddyfiles", async () => {
		const [caddy, deploy] = await Promise.all([read("deploy/Caddyfile.example"), read("deploy.sh")]);
		for (const line of ["reverse_proxy /direct 127.0.0.1:31888", "reverse_proxy /direct/* 127.0.0.1:31888"]) {
			expect(caddy).toContain(`\t${line}\n`);
			expect(deploy).toContain(line);
		}
	});

	it("upgrades every gateway WebSocket path in the Apache template", async () => {
		const apache = await read("deploy/apache-next-proxy.example.conf");
		for (const route of await gatewayWebSocketPaths()) {
			expect(apache).toContain(`RewriteRule ^${route}(.*)$ ws://{{SSH_WS_HOST}}:{{SSH_WS_PORT}}${route}$1 [P,L]`);
		}
	});

	it("keeps the previous Caddyfile before the installer re-renders it", async () => {
		const install = await read("deploy/install.sh");
		const backup = install.indexOf('cp -a "${DESTDIR}/etc/caddy/Caddyfile" "${DESTDIR}/etc/caddy/Caddyfile.bak.');
		const render = install.indexOf('install -m 0644 "${APP_DIR}/deploy/Caddyfile.example" "${DESTDIR}/etc/caddy/Caddyfile"');
		expect(backup).toBeGreaterThan(-1);
		expect(render).toBeGreaterThan(backup);
	});
});
