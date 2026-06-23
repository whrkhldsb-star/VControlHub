import { describe, expect, it } from "vitest";

import { buildCommand } from "../hosted-service";

describe("AI hosted command builder", () => {
	it("quotes read_logs arguments and uses fixed-string filtering", () => {
		expect(
			buildCommand("read_logs", {
				logPath: "/var/log/nginx/access.log",
				tail: 120,
				filter: "error's",
			}),
		).toBe("tail -n 120 -- '/var/log/nginx/access.log' | grep -F -i -- 'error'\\''s'");
	});

	it("rejects command injection attempts in auto-approved read_logs", () => {
		expect(buildCommand("read_logs", { logPath: "/var/log/syslog; touch /tmp/pwned", tail: 20 })).toBeNull();
		expect(buildCommand("read_logs", { logPath: "/var/log/syslog", tail: "20; id" })).toBeNull();
		expect(buildCommand("read_logs", { logPath: "/var/log/syslog", filter: "ok\nwhoami" })).toBeNull();
		expect(buildCommand("read_logs", { logPath: "../../etc/passwd", tail: 10 })).toBeNull();
	});

	it("builds the actual Docker listing command instead of falling back to generic status", () => {
		expect(buildCommand("list_docker_containers", {})).toBe("docker ps -a --format 'table {{.Names}}\	{{.Image}}\	{{.Status}}\	{{.Ports}}'");
	});

	it("builds targeted systemd status checks with sanitized service names", () => {
		expect(buildCommand("check_service_status", { serviceName: "nginx" })).toBe("systemctl status nginx --no-pager -l");
		expect(buildCommand("check_service_status", { serviceName: "nginx;reboot" })).toBeNull();
	});

	it("rejects unsafe high-risk command parameters before creating command requests", () => {
		expect(buildCommand("restart_service", { serviceName: "nginx;reboot" })).toBeNull();
		expect(buildCommand("modify_config", { configPath: "../../etc/passwd", content: "x" })).toBeNull();
		expect(buildCommand("modify_config", { configPath: "/etc/nginx/nginx.conf", content: "ok\nAIEOF\nreboot" })).toBeNull();
		expect(buildCommand("deploy_docker", { imageName: "nginx:latest", containerName: "web", ports: "80:80;reboot" })).toBeNull();
	});
});
