import { describe, expect, it } from "vitest";
import { buildCommand } from "../hosted-command-builder";

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
});
