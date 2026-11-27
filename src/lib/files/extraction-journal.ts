import { createHash, randomUUID } from "node:crypto";
import { lstat, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { prisma } from "@/lib/db";
import type { ExtractionResult } from "@/lib/storage/archive-extract";

export const EXTRACTION_INTENT_JOB_TYPE = "archive-extraction-intent";
const EXTRACTION_INTENT_TTL_MS = 24 * 60 * 60 * 1000;

export async function pruneExpiredExtractionIntents(now = new Date()): Promise<{ count: number }> {
  const cutoff = new Date(now.getTime() - EXTRACTION_INTENT_TTL_MS);
  return prisma.job.deleteMany({
    where: { type: EXTRACTION_INTENT_JOB_TYPE, updatedAt: { lt: cutoff } },
  });
}

// The record is outside the writable storage tree. The source identity survives the
// exclusive rename; identical names and member sizes do not establish ownership.
// Stored under status CANCELLED so durable job budgets and stale-lease recovery never
// count internal intent journals as active jobs.
export function extractionJournal(nodeId: string, archive: string, version: string, userId: string, teamId?: string | null) {
  const id = "extract-" + createHash("sha256").update(JSON.stringify([nodeId, archive, version, userId, teamId])).digest("hex");
  type Record = { folderName: string; identity: string; members: ExtractionResult["members"]; token: string | null; indexed?: boolean; stage?: string };
  const marker = `.vch-extract-${id}.tmp`;
  let prepared: Record | null = null;
  const identity = async (file: string) => {
    const st = await lstat(file, { bigint: true });
    return (st.isDirectory() || st.isFile()) && st.ino !== BigInt(0) ? `${st.isDirectory() ? "dir" : "file"}:${st.dev}:${st.ino}:${st.birthtimeNs}` : null;
  };
  return {
    async prepare(folderName: string, members: Record["members"], source: string) {
      const owner = await identity(source);
      if (!owner) return;
      const token = owner.startsWith("dir:") ? randomUUID() : null;
      if (token) await writeFile(path.join(source, marker), token, { flag: "wx", mode: 0o600 });
      const payload = { folderName, members, identity: owner, token, ...(token ? {} : { stage: path.basename(source) }) };
      await prisma.job.upsert({ where: { id }, create: { id, type: EXTRACTION_INTENT_JOB_TYPE, title: archive,
        createdBy: userId, teamId, targetStorageNodeId: nodeId, status: "CANCELLED", payload }, update: { payload, status: "CANCELLED" } });
      prepared = payload;
    },
    async published(parent: string) {
      const row = await prisma.job.findUnique({ where: { id }, select: { payload: true } });
      if (!row) return null;
      const rec = row.payload as Record;
      try {
        const target = path.join(parent, rec.folderName);
        if (await identity(target) !== rec.identity) return null;
        if (rec.token) {
          const value = await readFile(path.join(target, marker), "utf8").catch(error => {
            if (rec.indexed && error.code === "ENOENT") return rec.token;
            throw error;
          });
          if (value !== rec.token) return null;
        }
        prepared = rec;
        return rec;
      }
      catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error; }
    },
    async clear(parent?: string) {
      if (parent && prepared?.token) {
        // If cleanup is interrupted, an indexed record can finish clearing a
        // missing marker, but still requires the original directory identity.
        await prisma.job.update({ where: { id }, data: { payload: { ...prepared, indexed: true } } });
        const file = path.join(parent, prepared.folderName, marker);
        try { if (await readFile(file, "utf8") === prepared.token) await unlink(file); }
        catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
      } else if (parent && prepared?.stage) {
        const alias = path.join(parent, prepared.stage);
        try { if (await identity(alias) === prepared.identity) await unlink(alias); }
        catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
      }
      await prisma.job.deleteMany({ where: { id } });
    },
    marker,
  };
}
