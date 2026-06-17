import { describe, expect, it } from "vitest";

import manifest from "./manifest";

/**
 * Validates the dynamic PWA manifest exported by src/app/manifest.ts.
 *
 * Next.js 16 reads the default export of `app/manifest.ts` and serialises
 * it to `/manifest.webmanifest` at build time. The structure must satisfy
 * the W3C Web App Manifest spec for the browser to surface an
 * "Add to Home Screen" prompt.
 */
describe("app/manifest", () => {
	const result = manifest();

	it("exposes the PWA-required name and short_name", () => {
		expect(result.name).toBeTruthy();
		expect(result.short_name).toBeTruthy();
		expect(result.name).toContain(result.short_name as string);
	});

	it("uses standalone display so the app runs in its own window", () => {
		expect(result.display).toBe("standalone");
	});

	it("declares /dashboard as start_url so the app opens to a meaningful page", () => {
		expect(result.start_url).toBe("/dashboard");
		expect(result.scope).toBe("/");
	});

	it("ships at least one 192x192 and one 512x512 icon", () => {
		const icons: ReadonlyArray<{ sizes?: string; type?: string; src: string; purpose?: string }> =
			result.icons ?? [];
		const has192 = icons.some(
			(icon) => icon.sizes === "192x192" && icon.type === "image/png",
		);
		const has512 = icons.some(
			(icon) => icon.sizes === "512x512" && icon.type === "image/png",
		);
		expect(has192).toBe(true);
		expect(has512).toBe(true);
	});

	it("declares theme_color and background_color so the splash screen matches the brand", () => {
		expect(result.theme_color).toMatch(/^#[0-9a-fA-F]{3,8}$/);
		expect(result.background_color).toMatch(/^#[0-9a-fA-F]{3,8}$/);
	});
});
