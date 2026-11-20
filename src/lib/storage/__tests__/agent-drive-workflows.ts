import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { gunzipSync } from "node:zlib";
import { extract } from "tar-stream";
import * as undici from "undici";
import { expect, vi } from "vitest";
import { GET as downloadArchive } from "@/app/api/storage/archive-download/route";
import { POST as createDownload } from "@/app/api/downloads/route-post";
import type { SessionPayload } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { receiveAgentHttpDownload } from "@/lib/downloads/agent-relay";
import { copyFileEntry } from "@/lib/files/copy-operation";
import { getServerDeletionImpact } from "@/lib/server/service-deletion-impact";
import { deleteServerProfile } from "@/lib/server/service-profile-deletion";
import { transferServerToCustomer } from "@/lib/server/transfer";
import { createShareLink } from "@/lib/share-link/service";
import { pairFileShare } from "../agent-file-queue";
import { syncWebDavDirectoryEntries } from "../webdav-sync";

export async function checkDriveWorkflows(input: {
  actor: SessionPayload; serverId: string; nodeId: string; root: string; hub: string; apiToken: string; uploaded: string;
}) {
  const { actor, nodeId, root, serverId, hub, apiToken, uploaded } = input;
  const node = await prisma.storageNode.findUniqueOrThrow({ where: { id: nodeId } });
  const headers = { authorization: "Bearer " + apiToken, "content-type": "application/json" };
  const folder = "reports";
  const source = "note.txt";
  const entryWhere = (relativePath: string) => ({ storageNodeId_relativePath: { storageNodeId: nodeId, relativePath } });
  await writeFile(path.join(root, source), "first");
  await mkdir(path.join(root, folder));
  expect((await syncWebDavDirectoryEntries({ node })).errors).toEqual([]);
  const snapshot = await prisma.fileEntry.findUniqueOrThrow({ where: entryWhere(uploaded) });
  expect(snapshot.checksumSha256).toMatch(/^[a-f0-9]{64}$/);
  // Edit one byte without changing the length, using the server directory shared by the native Agent.
  const bytes = await readFile(path.join(root, uploaded));
  bytes[0] = bytes[0]! ^ 1;
  await writeFile(path.join(root, uploaded), bytes);
  await syncWebDavDirectoryEntries({ node });
  expect((await prisma.fileEntry.findUniqueOrThrow({ where: entryWhere(uploaded) })).checksumSha256).toBeNull();
  const entry = await prisma.fileEntry.findUniqueOrThrow({ where: entryWhere(source) });
  const copy = (policy: "skip" | "rename" | "overwrite") => copyFileEntry({ session: actor, fileEntryId: entry.id, targetDir: folder, policy });
  expect(await copy("rename")).toMatchObject({ copied: 1 });
  expect(await copy("skip")).toMatchObject({ skipped: true });
  await writeFile(path.join(root, source), "second");
  expect(await copy("overwrite")).toMatchObject({ copied: 1 });
  expect(await readFile(path.join(root, folder, source), "utf8")).toBe("second");
  const response = await downloadArchive(new Request(hub + "/api/storage/archive-download?" + new URLSearchParams({ nodeId, path: folder }), { headers }));
  expect(response.status).toBe(200);
  const tar = extract();
  const contents = new Map<string, string>();
  Readable.from([gunzipSync(Buffer.from(await response.arrayBuffer()))]).pipe(tar);
  for await (const member of tar) {
    const pieces: Buffer[] = [];
    for await (const piece of member) pieces.push(Buffer.from(piece as Uint8Array));
    contents.set(member.header.name, Buffer.concat(pieces).toString());
  }
  expect(contents.get(folder + "/" + source)).toBe("second");

  // No public socket is opened. Only the validated upstream document is supplied by the fixture.
  const url = "https://1.1.1.1/fixture.txt";
  const queued = await createDownload(new Request(hub + "/api/downloads", { method: "POST", headers,
    body: JSON.stringify({ url, serverId, targetPath: "/" + folder, fileName: "from-url.txt" }) }));
  expect(queued.status).toBe(200);
  const { taskId } = await queued.json();
  expect(await prisma.downloadTask.findUniqueOrThrow({ where: { id: taskId } })).toMatchObject({ agentStorageNodeId: nodeId, relayMode: true });
  const upstream = vi.mocked(undici.request).mockImplementation(async (address, options) => {
    expect(String(address)).toBe(url);
    return { statusCode: 200, headers: {}, body: Readable.from(options?.method === "HEAD" ? [] : [Buffer.from("offline payload")]) } as unknown as undici.Dispatcher.ResponseData;
  });
  try {
    await receiveAgentHttpDownload({ taskId, serverId, nodeId, url, targetPath: "/" + folder, fileName: "from-url.txt" });
  } finally { upstream.mockRestore(); }
  expect(await prisma.downloadTask.findUniqueOrThrow({ where: { id: taskId } })).toMatchObject({ status: "COMPLETED", completedBytes: "15" });
  expect(await readFile(path.join(root, folder, "from-url.txt"), "utf8")).toBe("offline payload");
  expect((await prisma.fileEntry.findUniqueOrThrow({ where: entryWhere(folder + "/from-url.txt") })).size).toBe(BigInt(15));
}

export async function checkDriveOwnership(actor: SessionPayload, serverId: string, nodeId: string) {
  const teamId = serverId + "-new";
  const sftp = await prisma.storageNode.create({ data: { driver: "SFTP", basePath: "/srv/files", serverId, teamId: actor.currentTeamId, name: "SFTP" } });
  await prisma.team.create({ data: { id: teamId, name: teamId, slug: teamId } });
  try {
    const { share } = await createShareLink({ session: actor, storageNodeId: sftp.id, path: "note.txt" });
    const impact = await getServerDeletionImpact(serverId);
    expect(impact.storageNodes).toBe(2);
    expect(impact.files).toBeGreaterThan(0);
    expect(impact.shares).toBe(1);
    await expect(deleteServerProfile(serverId, actor)).rejects.toThrow();
    await expect(transferServerToCustomer(serverId, teamId, actor)).rejects.toThrow();
    await prisma.shareLink.delete({ where: { id: share.id } });
    await transferServerToCustomer(serverId, teamId, actor);
    const drive = await prisma.agentFileShare.findUniqueOrThrow({ where: { storageNodeId: nodeId }, include: { node: true } });
    expect(drive).toMatchObject({ serverId, teamId, tokenHash: null, seenAt: null, writable: false, node: { teamId } });
    expect((await prisma.storageNode.findUniqueOrThrow({ where: { id: sftp.id } })).teamId).toBe(teamId);
    const token = await pairFileShare(nodeId, { ...actor, currentTeamId: teamId });
    expect(createHash("sha256").update(token).digest("hex")).toBe((await prisma.agentFileShare.findUniqueOrThrow({ where: { storageNodeId: nodeId } })).tokenHash);
  } finally {
    await prisma.storageNode.delete({ where: { id: sftp.id } });
    await prisma.team.delete({ where: { id: teamId } });
  }
}
