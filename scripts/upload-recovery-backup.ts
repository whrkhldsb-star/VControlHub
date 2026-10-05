import { prisma } from "@/lib/db";
import { uploadRecoveryBackup } from "@/lib/backup/recovery-offsite";

async function main() {
	try {
		const result = await uploadRecoveryBackup({ directory: process.env.BACKUP_DIR || `${process.cwd()}/backups`, enabled: process.env.OFFSITE_RECOVERY_UPLOAD_ENABLED === "true" });
		console.log(result.skipped ? `Recovery offsite upload skipped: ${result.reason}` : `Recovery offsite copy verified: ${result.bytes} bytes, SHA-256 ${result.sha256}`);
	} finally { await prisma.$disconnect(); }
}

void main().catch(() => {
	// Provider exceptions may include signed URLs or response text.
	console.error("Recovery offsite upload failed. The local backup is retained; check destination configuration and connectivity.");
	process.exitCode = 1;
});
