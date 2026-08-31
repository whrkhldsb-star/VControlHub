import { describe, expect, it } from "vitest";

/**
 * Structural checks over the whole quick-service catalogue.
 *
 * The seven `catalog-*.ts` files are static data with no tests of their own, but
 * they are not inert: every template is fed to `validateTemplate` at install
 * time, and a bad entry only surfaces when a user clicks Install. Running the
 * *real* validator across the whole catalogue turns that into a test failure —
 * it covers the host-mount allow-list (`/opt/`, `/srv/`, plus the two trusted
 * `/etc` files), the image-name and env-key patterns, and the port ranges in one
 * pass.
 *
 * The Docker-socket rule gets its own case. `assertHostVolumeAllowed` lets a
 * template mount `/var/run/docker.sock` only when it declares
 * `allowDockerSocket: true`, and that flag is effectively container-escape
 * privilege: the socket is the daemon API, and a read-only bind mount protects
 * the socket *file*, not the daemon behind it (the same fact behind the hub-host
 * scope fix). So the set of templates holding it is pinned by name — adding one
 * has to be a deliberate, reviewed edit rather than a quiet catalogue append.
 */
import { SERVICE_CATALOG } from "../catalog";
import { validateTemplate } from "../service-internals";

/** Templates permitted to mount the Docker socket. Extend only deliberately. */
const DOCKER_SOCKET_TEMPLATES = [
	// Docker management UI — the socket is its entire purpose.
	"portainer",
	// Smart-home platform that manages its own device containers. It is the
	// surprising member of this list, and the reason the set is asserted by name:
	// a template does not have to look like infrastructure to hold
	// container-escape privilege.
	"gladys",
];

describe("quick-service catalogue", () => {
	it("is non-empty", () => {
		expect(SERVICE_CATALOG.length).toBeGreaterThan(0);
	});

	it("passes the real install-time validator for every template", () => {
		// One failure here is a template that would only break when a user
		// clicked Install.
		const failures: string[] = [];
		for (const template of SERVICE_CATALOG) {
			try {
				validateTemplate(template);
			} catch (error) {
				failures.push(`${template.slug}: ${error instanceof Error ? error.message : String(error)}`);
			}
		}
		expect(failures).toEqual([]);
	});

	it("has no duplicate slugs", () => {
		// The slug is the QuickService unique key together with instanceKey, so a
		// duplicate would make two catalogue entries fight over one row.
		const slugs = SERVICE_CATALOG.map((t) => t.slug);
		expect(slugs).toHaveLength(new Set(slugs).size);
	});

	it("grants Docker-socket access to exactly the reviewed templates", () => {
		// The socket is the daemon API — mounting it is container-escape territory,
		// and `:ro` does not make the API read-only.
		const allowed = SERVICE_CATALOG.filter((t) => t.allowDockerSocket === true).map((t) => t.slug).sort();
		expect(allowed).toEqual([...DOCKER_SOCKET_TEMPLATES].sort());
	});

	it("only mounts the Docker socket from a template that declares the flag", () => {
		for (const template of SERVICE_CATALOG) {
			const mountsSocket = template.volumesJson.some((v) => v.host.trim().replace(/\/+$/, "") === "/var/run/docker.sock");
			if (mountsSocket) expect(template.allowDockerSocket).toBe(true);
		}
	});

	it("keeps every host mount inside the allowed roots", () => {
		// Mirrors assertHostVolumeAllowed so a violation names the template rather
		// than surfacing as a generic BusinessError during install.
		const offenders: string[] = [];
		for (const template of SERVICE_CATALOG) {
			for (const vol of template.volumesJson) {
				const host = vol.host.trim().replace(/\/+$/, "");
				const ok =
					host === "/var/run/docker.sock" ||
					host === "/etc/timezone" ||
					host === "/etc/localtime" ||
					host === "/opt" ||
					host === "/srv" ||
					host.startsWith("/opt/") ||
					host.startsWith("/srv/");
				if (!ok) offenders.push(`${template.slug} -> ${host}`);
			}
		}
		expect(offenders).toEqual([]);
	});

	it("uses absolute, traversal-free mount paths on both sides", () => {
		for (const template of SERVICE_CATALOG) {
			for (const vol of template.volumesJson) {
				expect(vol.host.startsWith("/"), `${template.slug} host`).toBe(true);
				expect(vol.host.includes(".."), `${template.slug} host`).toBe(false);
				expect(vol.container.startsWith("/"), `${template.slug} container`).toBe(true);
				expect(vol.container.includes(".."), `${template.slug} container`).toBe(false);
			}
		}
	});

	it("declares in-range TCP ports", () => {
		for (const template of SERVICE_CATALOG) {
			expect(Number.isInteger(template.defaultPort), template.slug).toBe(true);
			expect(template.defaultPort, template.slug).toBeGreaterThan(0);
			expect(template.defaultPort, template.slug).toBeLessThanOrEqual(65535);
			for (const ep of template.extraPorts ?? []) {
				expect(ep.host, template.slug).toBeGreaterThan(0);
				expect(ep.container, template.slug).toBeLessThanOrEqual(65535);
			}
		}
	});

	it("pins every image to a repository:tag rather than a bare name", () => {
		// A bare name resolves to :latest implicitly; the catalogue is explicit so
		// an operator can see what version a template installs.
		for (const template of SERVICE_CATALOG) {
			expect(template.image, template.slug).toMatch(/:[A-Za-z0-9_.-]+$|@sha256:/);
		}
	});

	it("gives every template the display fields the UI renders", () => {
		for (const template of SERVICE_CATALOG) {
			expect(template.name.trim(), template.slug).not.toBe("");
			expect(template.category.trim(), template.slug).not.toBe("");
			expect(template.description.trim(), template.slug).not.toBe("");
			expect(template.icon.trim(), template.slug).not.toBe("");
		}
	});

	it("keeps env var names in the shell-safe form the installer requires", () => {
		for (const template of SERVICE_CATALOG) {
			for (const key of Object.keys(template.envJson)) {
				expect(key, `${template.slug}:${key}`).toMatch(/^[A-Za-z_][A-Za-z0-9_]*$/);
			}
		}
	});
});
