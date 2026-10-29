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
		expect(buildCommand("read_file", { filePath: "/var/log/app log.txt", tail: 20 })).toBe("tail -n 20 -- '/var/log/app log.txt'");
		expect(buildCommand("list_files", { path: "/srv" })).toContain("find '/srv' -mindepth 1 -maxdepth 1");
		expect(buildCommand("read_file", { filePath: "/etc/../etc/passwd" })).toBeNull();
		expect(buildCommand("read_file", { filePath: "/etc/passwd;id" })).toBeNull();
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
