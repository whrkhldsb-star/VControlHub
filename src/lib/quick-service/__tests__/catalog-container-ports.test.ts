import { describe, expect, it } from "vitest";

import { SERVICE_CATALOG } from "../catalog";

/**
 * The default host port is not the port the image listens on. Without an
 * internalPort the install published 3002:3002 for Gitea (which listens on
 * 3000), 8110:8110 for File Browser (80), 8081:8081 for Vaultwarden (80), and
 * the service showed "running" while nothing answered on its port.
 *
 * The container ports below are the ones each project documents for its image
 * (the right-hand side of its own `-p host:container` example).
 */
describe("built-in templates publish the image's own port", () => {
	it.each([
		["nextcloud", 8080, 80],
		["filebrowser", 8110, 80],
		["davos", 8111, 8080],
		["jellyfin", 8097, 8096],
		["metube", 8088, 8081],
		["komga", 8083, 25600],
		["gitea", 3002, 3000],
		["vaultwarden", 8081, 80],
		["stirling-pdf", 8082, 8080],
		["it-tools", 8112, 80],
		["gladys", 8113, 80],
		["outline", 3010, 3000],
		["hedgedoc", 3011, 3000],
		["affine", 3012, 3010],
		["linkwarden", 3013, 3000],
		["wallabag", 3014, 80],
		["uptime-kuma", 3003, 3001],
		["adguardhome", 3004, 3000],
		["pihole", 8085, 80],
		["speedtest-tracker", 3005, 80],
		["beszel", 3006, 8090],
		["wordpress", 8084, 80],
		["typecho", 8086, 80],
		["dufs", 5001, 5000],
		["pairdrop", 3007, 3000],
		["tianji", 3015, 12345],
		["lobe-chat", 3016, 3210],
		["maxtext", 3017, 8080],
	])("%s: host %i, container %i", (slug, host, container) => {
		const template = SERVICE_CATALOG.find((item) => item.slug === slug)!;
		expect(template.defaultPort).toBe(host);
		expect(template.internalPort ?? template.defaultPort).toBe(container);
	});

	it("gives Portainer's plain-HTTP port to the plain-HTTP access link", () => {
		// With --http-enabled Portainer serves HTTP on 9000 and HTTPS on 9443; the
		// access link is http://host:<port>, which the HTTPS port refuses.
		const portainer = SERVICE_CATALOG.find((item) => item.slug === "portainer")!;
		expect(portainer.command).toContain("--http-enabled");
		expect(portainer.internalPort).toBe(9000);
	});

	it("runs Gladys on the port it is published on", () => {
		const gladys = SERVICE_CATALOG.find((item) => item.slug === "gladys")!;
		expect(gladys.envJson.SERVER_PORT).toBe(String(gladys.internalPort));
	});

	it("pulls Tianji from the repository the project publishes", () => {
		expect(SERVICE_CATALOG.find((item) => item.slug === "tianji")!.image).toBe("moonrailgun/tianji:latest");
	});
});
