// @vitest-environment node
import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * A complete uninstall stops, disables and deletes every systemd unit the
 * installer writes. The aria2 relay unit was left out, so it kept running
 * (Restart=always) after the application, its data and its user were gone.
 */
describe("uninstall service list", () => {
	it("covers every unit install.sh renders", async () => {
		const [install, uninstall] = await Promise.all([
			readFile(path.join(process.cwd(), "deploy/install.sh"), "utf8"),
			readFile(path.join(process.cwd(), "deploy/uninstall.sh"), "utf8"),
		]);
		const rendered = install.match(/for svc in ([a-z0-9 -]+); do/)![1]!.trim().split(/\s+/);
		expect(rendered).toContain("aria2");
		const units = uninstall.slice(uninstall.indexOf("units=("), uninstall.indexOf(")", uninstall.indexOf("units=(")));
		for (const svc of rendered) expect(units).toContain(`"\${SERVICE_PREFIX}-${svc}.service"`);
	});
});
