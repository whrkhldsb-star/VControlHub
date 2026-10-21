import { describe, expect, it } from "vitest";

import { getStorageAccessLabel, getStorageConnectionLabel } from "../domain-labels";
import { t } from "../translations";

const zh = (key: string, vars?: Record<string, string | number>) => t(key, "zh", vars);
const en = (key: string, vars?: Record<string, string | number>) => t(key, "en", vars);

describe("storage node labels", () => {
	it("describes each access mode in the viewer's language", () => {
		expect(getStorageAccessLabel(zh, "LOCAL", "proxy")).toBe("由管理端直接读取，受控下载与预览");
		expect(getStorageAccessLabel(zh, "WEBDAV", "proxy")).toBe("经管理端代理 WebDAV，浏览器不接触上游凭据");
		expect(getStorageAccessLabel(zh, "SFTP", "proxy")).toBe("经管理端 SFTP 中转下载");
		expect(getStorageAccessLabel(en, "SFTP", "direct-url")).toBe("Direct from the storage server when possible, falling back to the SFTP relay");
	});

	it("says where a node keeps its files", () => {
		expect(getStorageConnectionLabel(zh, { driver: "LOCAL", basePath: "/srv/files" })).toBe("本机目录 /srv/files");
		expect(getStorageConnectionLabel(en, { driver: "WEBDAV", basePath: "/dav" })).toBe("WebDAV directory /dav");
		expect(getStorageConnectionLabel(zh, { driver: "SFTP", basePath: "/data", host: "203.0.113.10", port: 2222, username: "ops" }))
			.toBe("ops@203.0.113.10:2222，根目录 /data");
		// A node that reaches SFTP through its bound server has no host of its own.
		expect(getStorageConnectionLabel(zh, { driver: "SFTP", basePath: "/data", host: null })).toBe("绑定的服务器，根目录 /data");
	});
});
