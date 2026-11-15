// @vitest-environment node
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

import { describe, expect, it } from "vitest";

import { getJobTitleLabel, getOperationTaskTitle } from "../domain-labels";
import { t } from "../translations";

const zh = (key: string, vars?: Record<string, string | number>) => t(key, "zh", vars);
const en = (key: string, vars?: Record<string, string | number>) => t(key, "en", vars);

describe("background job titles", () => {
	it("says the titles jobs are stored with in the page's language", () => {
		expect(getJobTitleLabel(zh, "Alert rule evaluation")).toBe("评估告警规则");
		expect(getJobTitleLabel(en, "Alert rule evaluation")).toBe("Evaluate alert rules");
		expect(getJobTitleLabel(zh, "Run playbook 夜间维护")).toBe("运行 Playbook：夜间维护");
		expect(getJobTitleLabel(zh, "Create DATABASE backup")).toBe("创建数据库备份");
		expect(getJobTitleLabel(en, "Drill FULL backup")).toBe("Full backup restore drill");
		expect(getJobTitleLabel(zh, "Backup retention (30d)")).toBe("清理 30 天前的备份");
		expect(getJobTitleLabel(en, "Backup retention (1d)")).toBe("Clean up backups older than 1 day");
		expect(getJobTitleLabel(zh, "VPS backup: mysql (web-1)")).toBe("VPS 备份：MySQL 数据库（web-1）");
		expect(getJobTitleLabel(zh, "VPS backup: 每晚")).toBe("VPS 备份计划：每晚");
		expect(getJobTitleLabel(zh, "ITSM ticket.created: Disk full on web-1")).toBe("ITSM 推送（工单已创建）：Disk full on web-1");
		expect(getJobTitleLabel(zh, "SFTP stale inventory: team scope (3)")).toBe("清点 SFTP 失效条目（当前客户的 3 个节点）");
	});

	it("keeps a title it does not know as stored", () => {
		expect(getJobTitleLabel(zh, "安装快捷服务：AList")).toBe("安装快捷服务：AList");
		expect(getJobTitleLabel(zh, "Something else")).toBe("Something else");
		// An unknown backup type stays as it was written rather than becoming a key.
		expect(getJobTitleLabel(zh, "Create SNAPSHOT backup")).toBe("Create SNAPSHOT backup");
	});

	it("names a task by its source: jobs through their titles, backups by type, the rest as named", () => {
		expect(getOperationTaskTitle(zh, { source: "job", title: "Sample fleet health" })).toBe("采集节点健康状态");
		expect(getOperationTaskTitle(zh, { source: "backup", taskType: "FILES", title: "FILES backup" })).toBe("文件备份");
		expect(getOperationTaskTitle(zh, { source: "backup", title: "DATABASE backup" })).toBe("数据库备份");
		// A command a person titled "Run playbook x" is theirs, not a job title.
		expect(getOperationTaskTitle(zh, { source: "command", title: "Run playbook x" })).toBe("Run playbook x");
	});

	// Every title the platform gives a job is one of the known forms: a new English title would otherwise reach
	// Chinese pages unnoticed. Placeholders in a template are filled with a sample value of their kind.
	it("covers every title a job is created with", () => {
		const root = join(process.cwd(), "src");
		const files: string[] = [];
		const walk = (dir: string) => {
			for (const entry of readdirSync(dir)) {
				if (entry === "node_modules" || entry === "__tests__") continue;
				const path = join(dir, entry);
				if (statSync(path).isDirectory()) walk(path);
				else if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry)) files.push(path);
			}
		};
		walk(root);
		const sample = (expression: string) => (/eventType/.test(expression) ? "ticket.created" : /type/i.test(expression) ? "FULL" : /days/i.test(expression) ? "30" : /length/.test(expression) ? "3" : /\baction\b/.test(expression) ? "move" : "sample");
		const unknown: string[] = [];
		let found = 0;
		for (const file of files) {
			const source = readFileSync(file, "utf8");
			for (const call of source.matchAll(/(?:\benqueueJob\s*\(\s*\{|\.job\.create\(\s*\{\s*data:\s*\{)[\s\S]{0,600}?\btitle:\s*(?:([`"])((?:(?!\1)[^\\]|\\.)*)\1|[^,\n]+\?\s*([`"])((?:(?!\3)[^\\]|\\.)*)\3\s*:\s*([`"])((?:(?!\5)[^\\]|\\.)*)\5)/g)) {
				const literals = call[2] !== undefined ? [call[2]] : [call[4]!, call[6]!];
				for (const literal of literals) {
					found++;
					const title = literal.replace(/\$\{([^}]*)\}/g, (_, expression: string) => sample(expression));
					if (getJobTitleLabel(zh, title) === title) unknown.push(`${relative(process.cwd(), file)}: ${literal}`);
				}
			}
		}
		expect(found).toBeGreaterThan(15);
		expect(unknown).toEqual([]);
	});
});
