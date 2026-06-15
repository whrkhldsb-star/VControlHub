/**
 * TR-051: 一键检查 ADMIN_INITIAL_PASSWORD (env) 与 DB 中 admin 用户的
 * passwordHash 是否一致。退出码: 0=OK, 1=不一致/异常。
 *
 * 用法:
 *   npx tsx scripts/admin-consistency-check.ts
 *   npm run admin:consistency-check
 */
import { config } from "dotenv";
import { verifyAdminPasswordConsistency } from "../src/lib/auth/bootstrap";

// 在 tsx 直接运行时加载 .env.local (Next.js 启动时自动加载, 但 tsx 不会)
config({ path: ".env.local" });
config({ path: ".env" });

const main = async () => {
	const result = await verifyAdminPasswordConsistency();
	if (result.ok) {
		console.log(`✅ admin password consistency OK (user=${result.username})`);
		process.exit(0);
	}
	console.error(`❌ admin password consistency FAILED`);
	console.error(`   reason: ${result.reason}`);
	console.error(`   ${result.message}`);
	process.exit(1);
};

main().catch((err) => {
	console.error("admin-consistency-check crashed:", err);
	process.exit(2);
});
