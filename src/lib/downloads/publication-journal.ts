import { prisma } from "@/lib/db";
import { ConflictError } from "@/lib/errors";
import { t } from "@/lib/i18n/service-translations";
import { lockDownloadClaim, type DownloadClaim } from "./claim";
import { parseTransferManifest, type TransferManifest } from "./transfer-manifest";

type File = TransferManifest["files"][number];
export function assertOriginalGeneration(file: File, current: string) {
  if (file.publication && file.publication.original !== current) {
    throw new ConflictError(t("backend.storage.editableFileChangedOnDisk"));
  }
}

/** Commit the intent separately: a rollback of the index transaction cannot erase it. */
export async function journalPublication(taskId: string, claim: DownloadClaim | undefined, file: File, original: string, staged?: string) {
  await prisma.$transaction(async tx => {
    await lockDownloadClaim(tx, claim);
    const rows = await tx.$queryRaw<{ transferManifest: unknown }[]>`SELECT "transferManifest" FROM download_tasks
      WHERE id = ${taskId} AND status = 'RUNNING' FOR UPDATE`;
    const manifest = parseTransferManifest(rows[0]?.transferManifest);
    const member = manifest?.files.find(item => item.name === file.name && item.sha256 === file.sha256);
    if (!member || !manifest) throw new Error("Missing relay publication manifest");
    assertOriginalGeneration(member, original);
    member.publication = { original, ...(staged && { staged }) };
    await tx.downloadTask.update({ where: { id: taskId }, data: { transferManifest: manifest } });
  });
}
