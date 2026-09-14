import { expect, test } from "@playwright/test";
import { installDirectSession } from "./helpers/direct-session";
import { loginWithCredentials } from "./helpers/login";

test("WebDAV file lifecycle enforces token scopes over real HTTP methods", async ({ page, context }) => {
	test.setTimeout(60_000);
	if (process.env.E2E_DIRECT_SESSION === "1") await installDirectSession(context);
	else await loginWithCredentials(page, process.env.E2E_USER ?? "admin", process.env.E2E_PASS ?? "admin123");
	const csrf = (await context.cookies()).find((cookie) => cookie.name === "csrf_token")?.value;
	expect(csrf).toBeTruthy();
	const tokens: Array<{ token: string; apiToken: { id: string } }> = [];
	const directoryName = `e2e-webdav-${Date.now()}-\u{1f4c1}-%_`;
	const directory = `/api/webdav/node_local_default/${encodeURIComponent(directoryName)}`;
	let createdDirectory = false;
	try {
		for (const scopes of [["storage:read", "storage:write", "storage:delete"], ["storage:read"]]) {
			const response = await context.request.post("/api/api-tokens", {
				headers: { "x-csrf-token": csrf! },
				data: { name: `WebDAV E2E ${scopes.length}`, scopes },
			});
			expect(response.status()).toBe(201);
			tokens.push(await response.json());
		}
		const headers = { Authorization: `Bearer ${tokens[0]!.token}` };
		const readHeaders = { Authorization: `Bearer ${tokens[1]!.token}` };
		const mkdir = await context.request.fetch(directory, { method: "MKCOL", headers });
		expect(mkdir.status()).toBe(201);
		createdDirectory = true;
		const file = `${directory}/original.bin`;
		const bytes = Buffer.from([0, 1, 127, 128, 255, 10]);
		const put = await context.request.put(file, { headers: { ...headers, "Content-Type": "application/octet-stream" }, data: bytes });
		expect(put.status()).toBe(201);
		const read = await context.request.get(file, { headers: readHeaders });
		expect(read.status()).toBe(200);
		expect(await read.body()).toEqual(bytes);
		const range = await context.request.get(file, { headers: { ...readHeaders, Range: "bytes=2-4" } });
		expect(range.status()).toBe(206);
		expect(range.headers()["content-range"]).toBe("bytes 2-4/6");
		expect(await range.body()).toEqual(bytes.subarray(2, 5));
		const denied = await context.request.delete(file, { headers: readHeaders });
		expect([401, 403]).toContain(denied.status());
		const moved = `${directory}/renamed.bin`;
		// Destination must stay origin-agnostic: Next.js may normalize the
		// request host (127.0.0.1 -> localhost) behind a custom server, so an
		// absolute URL minted from the test baseURL can mismatch the origin
		// the handler sees and trip the same-origin guard. A relative
		// Destination is resolved against the request's own origin instead.
		const move = await context.request.fetch(file, { method: "MOVE", headers: { ...headers, Destination: moved, Overwrite: "F" } });
		expect(move.status(), `MOVE failed: ${await move.text()}`).toBe(201);
		const listing = await context.request.fetch(directory, { method: "PROPFIND", headers: { ...readHeaders, Depth: "1" } });
		expect(listing.status()).toBe(207);
		expect(await listing.text()).toContain("renamed.bin");
		expect((await context.request.get(file, { headers })).status()).toBe(404);
		expect((await context.request.delete(moved, { headers })).status()).toBe(204);
		expect((await context.request.get(moved, { headers })).status()).toBe(404);
	} finally {
		if (createdDirectory) {
			await context.request.delete(directory, { headers: { Authorization: `Bearer ${tokens[0]!.token}` } });
		}
		for (const token of tokens) {
			await context.request.delete(`/api/api-tokens?id=${encodeURIComponent(token.apiToken.id)}`, { headers: { "x-csrf-token": csrf! } });
		}
	}
});
