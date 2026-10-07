/** Administrator-only local command. No target writes or automatic file deletion. */
import { prisma } from "../src/lib/db";

async function main() {
  const [action = "list", id, confirmation] = process.argv.slice(2);
  if (action === "list") {
    const rows = await prisma.mediaUploadSession.findMany({
      where: { OR: [{ recoveryRequired: true }, { status: "FINALIZING", finalizationToken: null }] },
      select: { id: true, userId: true, filename: true, status: true, storageNodeId: true, relativePath: true, updatedAt: true, recoveryRequired: true, recoveryMetadata: true },
      orderBy: { updatedAt: "asc" }, take: 100,
    });
    console.log(JSON.stringify(rows, null, 2));
    return;
  }
  if (action !== "acknowledge" || !id || confirmation !== "ALL_WRITERS_STOPPED_AND_TARGET_REVIEWED") {
    throw new Error("Usage: upload:recovery [list | acknowledge SESSION_ID ALL_WRITERS_STOPPED_AND_TARGET_REVIEWED]");
  }
  const result = await prisma.mediaUploadSession.updateMany({
    where: { id, OR: [{ status: "FAILED", recoveryRequired: true }, { status: "FINALIZING", finalizationToken: null }] },
    data: { status: "FAILED", recoveryRequired: false, finalizationToken: null, finalizationLeaseUntil: null, errorMessage: "Administrator reviewed target and stopped previous writers; explicit re-upload is allowed." },
  });
  if (result.count !== 1) throw new Error("No reviewable upload matched; active leased and completed uploads cannot be acknowledged.");
  console.log("Review acknowledged. Existing data retained; user may explicitly select the source to retry.");
}
main().catch((error: unknown) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; }).finally(() => prisma.$disconnect());
