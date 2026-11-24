import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildCommand, isSensitiveRemotePath } from "../hosted-command-builder";

describe("hosted AI command builder", () => {
	it("backs up a config file under a timestamped name the shell expands", () => {
		const command = buildCommand("modify_config", { configPath: "/etc/nginx/nginx.conf", content: "worker_processes 2;" });
		expect(command).not.toBeNull();
		// Quoted, `$(date +%s)` was a literal file name and every backup overwrote the last.
		expect(command).toContain("cp -- '/etc/nginx/nginx.conf' '/etc/nginx/nginx.conf.bak.'$(date +%s) && ");
		expect(command).not.toContain("$(date +%s)'");
		expect(command).toContain("<< 'AIEOF'\nworker_processes 2;\nAIEOF");
	});

	it("single-quotes file paths handed to tail and find", () => {
		expect(buildCommand("read_file", { filePath: "/var/log/app log.txt", tail: 20 })).toContain("'/var/log/app log.txt' file tail -n 20");
		expect(buildCommand("list_files", { path: "/srv" })).toContain("'/srv' directory");
		expect(buildCommand("read_file", { filePath: "/etc/../etc/passwd" })).toBeNull();
		expect(buildCommand("read_file", { filePath: "/etc/passwd;id" })).toBeNull();
	});

	it.skipIf(process.platform !== "linux")("keeps mandatory credential exclusions for every search pattern", () => {
		const dir = mkdtempSync(join(tmpdir(), "hosted-search-"));
		try {
			for (const name of [".env.production", "id_rsa.old", "tls.KEY", "signing.jks", "ok.log"]) {
				writeFileSync(join(dir, name), "matching fixture\n");
			}
			symlinkSync(join(dir, "tls.KEY"), join(dir, "alias.log"));
			mkdirSync(join(dir, ".ssh"));
			writeFileSync(join(dir, ".ssh", "file.log"), "matching fixture\n");
			symlinkSync(join(dir, ".ssh"), join(dir, "linked-dir"));
			for (const filePattern of [undefined, "*", "*.log", ".env*", "id_rsa.*", "*.KEY", "*.jks"]) {
				const command = buildCommand("search_files", { path: dir, query: "matching", filePattern });
				const result = spawnSync("sh", ["-c", command!], { encoding: "utf8" });
				expect(result.status).toBe(0);
				const allowed = !filePattern || ["*", "*.log"].includes(filePattern);
				expect(result.stdout.trim(), filePattern).toBe(allowed ? `${dir}/ok.log:1:matching fixture` : "");
			}
			const searchLink = buildCommand("search_files", { path: join(dir, "linked-dir"), query: "matching" });
			const result = spawnSync("sh", ["-c", searchLink!], { encoding: "utf8" });
			expect(result.status).not.toBe(0);
			expect(result.stdout).toBe("");
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it.skipIf(process.platform !== "linux")("lists a checked directory, reports missing directories and caps large results", () => {
		const dir = mkdtempSync(join(tmpdir(), "hosted-list-"));
		const list = (path: string) => spawnSync("sh", ["-c", buildCommand("list_files", { path })!], { encoding: "utf8" });
		try {
			expect(list(dir)).toMatchObject({ status: 0, stdout: "" });
			expect(list(join(dir, "missing")).status).not.toBe(0);
			mkdirSync(join(dir, ".ssh", "nested"), { recursive: true });
			symlinkSync(join(dir, ".ssh"), join(dir, "alias"));
			expect(list(join(dir, "alias", "nested")).status).not.toBe(0);
			for (let i = 0; i < 205; i++) writeFileSync(join(dir, "entry-" + i), "");
			const large = list(dir);
			expect(large.status).toBe(0);
			expect(large.stdout.trimEnd().split("\n")).toHaveLength(200);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it.skipIf(process.platform !== "linux")("reads allowed links and refuses protected targets for both tail tools", () => {
		const dir = mkdtempSync(join(tmpdir(), "hosted-read-"));
		try {
			const privateDir = join(dir, ".ssh");
			mkdirSync(privateDir);
			writeFileSync(join(privateDir, "fixture"), "directory fixture\n");
			writeFileSync(join(dir, "fixture.KEY"), "name fixture\n");
			writeFileSync(join(dir, "regular.log"), "old\nrecent\n");
			symlinkSync(join(dir, "regular.log"), join(dir, "safe.log"));
			symlinkSync(join(dir, "fixture.KEY"), join(dir, "private.log"));
			symlinkSync(privateDir, join(dir, "alias-dir"));
			for (const type of ["read_file", "read_logs"] as const) {
				for (const relative of ["safe.log", "private.log", "alias-dir/fixture"]) {
					const path = join(dir, relative);
					const command = buildCommand(type, { filePath: path, logPath: path, tail: 1 });
					const result = spawnSync("sh", ["-c", command!], { encoding: "utf8" });
					if (relative === "safe.log") {
						expect(result.status).toBe(0);
						expect(result.stdout).toBe("recent\n");
					} else {
						expect(result.status).not.toBe(0);
						expect(result.stdout).toBe("");
					}
				}
			}
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it.skipIf(process.platform !== "linux")("tails the checked descriptor across a log rotation", () => {
		const dir = mkdtempSync(join(tmpdir(), "hosted-rotate-"));
		try {
			const path = join(dir, "service.log");
			writeFileSync(path, "opened log\n");
			// Rotate the log just as tail starts, after the descriptor has been checked.
			writeFileSync(join(dir, "tail"), [
				"#!/bin/sh",
				'mv "$FIXTURE_LOG" "$FIXTURE_LOG.1"',
				'echo replacement > "$FIXTURE_LOG"',
				'exec /usr/bin/tail "$@"',
			].join("\n"), { mode: 0o755 });
			const command = buildCommand("read_logs", { logPath: path, tail: 1 });
			const result = spawnSync("sh", ["-c", command!], {
				encoding: "utf8", env: { ...process.env, PATH: `${dir}:${process.env.PATH}`, FIXTURE_LOG: path },
			});
			expect(result.status).toBe(0);
			expect(result.stdout).toBe("opened log\n");
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("keeps recursive search out of system secret stores and container/cluster state (D6-01)", () => {
		for (const path of [
			"/run", "/run/secrets", "/var/run", "/var/run/docker", "/var/lib/docker", "/var/lib/docker/containers",
			"/etc/kubernetes", "/etc/rancher", "/etc/rancher/k3s", "/etc/wireguard", "/var/lib/rancher", "/var/lib/kubelet",
			"/srv/app/secrets",
		]) {
			expect(buildCommand("search_files", { path, query: "x", filePattern: "*" }), path).toBeNull();
		}
		const command = buildCommand("search_files", { path: "/etc", query: "PrivateKey", filePattern: "*" });
		expect(command).not.toBeNull();
		for (const dir of ["secrets", "wireguard", "kubernetes", "k3s", "rancher", "kubelet"]) {
			expect(command).toContain(`--exclude-dir='${dir}'`);
		}
		for (const name of ["[aA][dD][mM][iI][nN].[cC][oO][nN][fF]", "[kK]3[sS].[yY][aA][mM][lL]", "[cC][oO][nN][fF][iI][gG].[vV]2.[jJ][sS][oO][nN]"]) {
			expect(command).toContain(`--exclude='${name}'`);
		}
		expect(command).toContain("' tree sh -c ");
		// Listing a parent directory stays allowed; only the recursive read is refused.
		expect(buildCommand("list_files", { path: "/run" })).not.toBeNull();
		expect(buildCommand("search_files", { path: "/var/log", query: "error", filePattern: "*.log" })).not.toBeNull();
	});

	it.skipIf(process.platform !== "linux")("skips nested secret stores during a recursive search", () => {
		const dir = mkdtempSync(join(tmpdir(), "hosted-search-secrets-"));
		try {
			for (const nested of ["secrets", "wireguard", "kubernetes", join("rancher", "k3s")]) {
				mkdirSync(join(dir, nested), { recursive: true });
				writeFileSync(join(dir, nested, "value.txt"), "matching fixture\n");
			}
			mkdirSync(join(dir, "containers", "abc"), { recursive: true });
			writeFileSync(join(dir, "containers", "abc", "config.v2.json"), "matching fixture\n");
			writeFileSync(join(dir, "admin.conf"), "matching fixture\n");
			writeFileSync(join(dir, "k3s.yaml"), "matching fixture\n");
			writeFileSync(join(dir, "ok.log"), "matching fixture\n");
			const command = buildCommand("search_files", { path: dir, query: "matching" });
			const result = spawnSync("sh", ["-c", command!], { encoding: "utf8" });
			expect(result.status).toBe(0);
			expect(result.stdout.trim()).toBe(`${dir}/ok.log:1:matching fixture`);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("keeps the unattended read tools out of credential files, key stores and device nodes", () => {
		// Their output goes to the AI provider and into the conversation with nobody approving the read.
		for (const path of [
			"/etc/shadow", "/etc/gshadow-", "/etc/sudoers", "/etc/sudoers.d/90-cloud", "/etc/ssh/ssh_host_ed25519_key",
			"/root/.ssh", "/root/.ssh/authorized_keys", "/home/app/.aws/credentials", "/srv/app/.env", "/srv/app/.env.production",
			"/opt/app/tls/server.key", "/opt/app/tls/cert.pem", "/home/app/.bash_history", "/home/app/.config/gcloud/x.json",
			"/dev/zero", "/proc/1/environ",
		]) {
			expect(isSensitiveRemotePath(path), path).toBe(true);
			expect(buildCommand("read_file", { filePath: path }), path).toBeNull();
			expect(buildCommand("list_files", { path }), path).toBeNull();
			expect(buildCommand("search_files", { path, query: "x", filePattern: "*" }), path).toBeNull();
		}
		for (const path of ["/etc/ssh/sshd_config", "/etc/passwd", "/var/log/nginx", "/srv/app/env.example", "/home/app/.envrc.d", "/proc/cpuinfo", "/etc/ssh/ssh_host_ed25519_key.pub"]) {
			expect(isSensitiveRemotePath(path), path).toBe(false);
			expect(buildCommand("read_file", { filePath: path }), path).not.toBeNull();
		}
	});
});
