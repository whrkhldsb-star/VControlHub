import { tellStatus } from "@/lib/aria2/service";

/** A magnet starts a metadata download which spawns the actual torrent. */
export async function relayContentStatus(initialGid: string) {
  let gid = initialGid;
  const visited = new Set([gid]);
  for (;;) {
    const status = await tellStatus(gid);
    if (!status.followedBy?.length) return { gid, status };
    const [next] = status.followedBy;
    if (status.followedBy.length !== 1 || !next || !/^[a-f0-9]{16}$/i.test(next) || visited.has(next) || visited.size >= 8) {
      throw new Error("Ambiguous aria2 content download");
    }
    visited.add(next);
    gid = next;
  }
}
