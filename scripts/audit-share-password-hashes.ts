import { prisma } from "../src/lib/db";

process.loadEnvFile(".env.local");

async function main() {
	const strict = process.argv.includes("--strict");
	const now = new Date();

	const [activeProtected, activeLegacy, expiredLegacy, revokedLegacy] = await Promise.all([
	prisma.shareLink.count({
		where: { passwordHash: { not: null }, revokedAt: null, OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] },
	}),
	prisma.shareLink.count({
		where: {
			passwordHash: { not: null },
			revokedAt: null,
			OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
			NOT: { passwordHash: { startsWith: "scrypt:" } },
		},
	}),
	prisma.shareLink.count({
		where: { passwordHash: { not: null }, expiresAt: { lte: now }, NOT: { passwordHash: { startsWith: "scrypt:" } } },
	}),
	prisma.shareLink.count({
		where: { passwordHash: { not: null }, revokedAt: { not: null }, NOT: { passwordHash: { startsWith: "scrypt:" } } },
	}),
]);

	const report = {
	checkedAt: now.toISOString(),
	activeProtected,
	activeModern: activeProtected - activeLegacy,
	activeLegacy,
	expiredLegacy,
	revokedLegacy,
	readyToRemoveLegacyVerifier: activeLegacy === 0,
};

	console.log(JSON.stringify(report, null, 2));
	if (strict && activeLegacy > 0) process.exitCode = 1;
}

main()
	.catch((error) => {
		console.error(error);
		process.exitCode = 1;
	})
	.finally(() => prisma.$disconnect());
