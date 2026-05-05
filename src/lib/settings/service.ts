import { prisma } from "@/lib/db";

/* ── Default settings ─────────────────────────────────────── */

const DEFAULTS: Record<string, string> = {
	"platform.name": "VPS 统一管控平台",
	"platform.logo": "",
	"session.timeout": "86400",
	"password.minLength": "8",
	"password.requireUppercase": "true",
	"password.requireNumber": "true",
	"password.requireSpecial": "false",
	"smtp.host": "",
	"smtp.port": "587",
	"smtp.user": "",
	"smtp.pass": "",
	"smtp.from": "",
	"smtp.enabled": "false",
};

/* ── Get / Set ────────────────────────────────────────────── */

export async function getSetting(key: string): Promise<string> {
	const row = await prisma.setting.findUnique({ where: { key } });
	return row?.value ?? DEFAULTS[key] ?? "";
}

export async function getAllSettings(): Promise<Record<string, string>> {
	const rows = await prisma.setting.findMany();
	const result: Record<string, string> = { ...DEFAULTS };
	for (const row of rows) {
		result[row.key] = row.value;
	}
	return result;
}

export async function setSetting(key: string, value: string): Promise<void> {
	await prisma.setting.upsert({
		where: { key },
		update: { value },
		create: { key, value },
	});
}

export async function setManySettings(entries: Array<{ key: string; value: string }>): Promise<void> {
	await prisma.$transaction(
		entries.map(({ key, value }) =>
			prisma.setting.upsert({
				where: { key },
				update: { value },
				create: { key, value },
			})
		)
	);
}
