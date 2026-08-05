/**
 * TR-051: 检查 admin 是否仍使用与运行时环境一致的初始密码，或已完成轮换。
 * 退出码: 0=状态一致/已轮换, 1=不一致/异常。
 *
 * 用法:
 *   npx tsx scripts/admin-consistency-check.ts
 *   npm run admin:consistency-check
 */
import { config } from "dotenv";

// systemd uses .env.runtime. Load it before importing auth config so module-level
// constants see the same values as production; local/dev files are fallbacks.
config({ path: ".env.runtime", override: false });
config({ path: ".env.local", override: false });
config({ path: ".env", override: false });

const main = async () => {
	const { verifyAdminPasswordConsistency } = await import(
		"../src/lib/auth/bootstrap"
	);
	const result = await verifyAdminPasswordConsistency();
	if (result.ok) {
		console.log(
			`✅ admin credential state OK (user=${result.username}, mode=${result.mode})`,
		);
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
