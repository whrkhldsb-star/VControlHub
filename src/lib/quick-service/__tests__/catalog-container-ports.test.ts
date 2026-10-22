import { describe, expect, it } from "vitest";

import { DEVTOOLS_SERVICE_TEMPLATES } from "../catalog-devtools";
import { MEDIA_SERVICE_TEMPLATES } from "../catalog-media";
import { NETWORK_SERVICE_TEMPLATES } from "../catalog-network";

/**
 * The default host port is not the port the image listens on. Without an
 * internalPort the install published 3002:3002 for Gitea (which listens on
 * 3000), 8097:8097 for Jellyfin (8096) and 3003:3003 for Uptime Kuma (3001),
 * and the service could not be reached.
 */
describe("built-in templates publish the image's own port", () => {
	const all = [...DEVTOOLS_SERVICE_TEMPLATES, ...MEDIA_SERVICE_TEMPLATES, ...NETWORK_SERVICE_TEMPLATES];
	it.each([
		["gitea", 3002, 3000],
		["jellyfin", 8097, 8096],
		["uptime-kuma", 3003, 3001],
	])("%s: host %i, container %i", (slug, host, container) => {
		const template = all.find((item) => item.slug === slug)!;
		expect(template.defaultPort).toBe(host);
		expect(template.internalPort ?? template.defaultPort).toBe(container);
	});
});
