import { describe, expect, it } from "vitest";

import { transferFileViaSsh2 } from "./execution";

describe("relay transfer SSH trust", () => {
	it("refuses to send files or credentials to an unpinned SSH host", async () => {
		await expect(
			transferFileViaSsh2(
				{ host: "203.0.113.30", port: 22, username: "root", connectionType: "PASSWORD", sshKeyId: null, password: "encrypted-password", hostKeySha256: null },
				"/tmp/local.iso",
				"/srv/files/remote.iso",
				"task-1",
			),
		).rejects.toThrow(/host key|fingerprint|指纹/i);
	});
});