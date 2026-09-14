import type { SessionPayload } from "@/lib/auth/session";
import type {
  FileEntryListRow,
  DeletedFileEntryRow,
} from "./service-entries";
import { listFileEntries, listDeletedFileEntries } from "./service-entries";
import { listStorageNodes } from "./service-nodes";
import { getFileIndexStatistics } from "./service-statistics";
import type { StorageNodeListRow } from "./service-direct-access";

type TeamSession = Pick<SessionPayload, "userId" | "roles" | "currentTeamId">;

type DirectorySummary = {
  storageNodeId: string;
  storageNodeName: string;
  storageNodeDriver: "LOCAL" | "SFTP" | "WEBDAV";
  path: string;
  name: string;
  itemCount: number;
};

function buildDirectorySummaries(
  entries: Awaited<ReturnType<typeof listFileEntries>>,
) {
  const directories = new Map<string, DirectorySummary>();

  const registerDirectory = (input: {
    storageNodeId: string;
    storageNodeName: string;
    storageNodeDriver: "LOCAL" | "SFTP" | "WEBDAV";
    path: string;
  }) => {
    const normalizedPath = input.path.replace(/^\/+|\/+$/g, "");
    if (!normalizedPath) {
      return;
    }

    const key = `${input.storageNodeId}:${normalizedPath}`;
    const existing = directories.get(key);
    if (existing) {
      existing.itemCount += 1;
      return;
    }

    const segments = normalizedPath.split("/").filter(Boolean);
    directories.set(key, {
      storageNodeId: input.storageNodeId,
      storageNodeName: input.storageNodeName,
      storageNodeDriver: input.storageNodeDriver,
      path: normalizedPath,
      name: segments.at(-1) ?? normalizedPath,
      itemCount: 1,
    });
  };

  for (const entry of entries) {
    const segments = entry.relativePath.split("/").filter(Boolean);
    if (segments.length === 0) {
      continue;
    }

    const limit =
      entry.entryType === "DIRECTORY" ? segments.length : segments.length - 1;
    for (let index = 0; index < limit; index += 1) {
      registerDirectory({
        storageNodeId: entry.storageNode.id,
        storageNodeName: entry.storageNode.name,
        storageNodeDriver: entry.storageNode.driver as "LOCAL" | "SFTP" | "WEBDAV",
        path: segments.slice(0, index + 1).join("/"),
      });
    }
  }

  return [...directories.values()].sort((left, right) =>
    left.path.localeCompare(right.path),
  );
}

export type { DirectorySummary };

export async function getStorageOverview(session?: TeamSession | null, options: {includeEntries?: boolean} = {}) {
  const [nodes, entries, deletedEntries] = await Promise.all([
    listStorageNodes(session),
    options.includeEntries === false ? Promise.resolve([]) : listFileEntries(undefined, {}, session),
    options.includeEntries === false ? Promise.resolve([]) : listDeletedFileEntries(undefined, {}, session),
  ]);
  const remoteDirectories = buildDirectorySummaries(entries);
  const indexStats = await getFileIndexStatistics(nodes.map((node) => node.id));

  return {
    nodes,
    entries,
    deletedEntries,
    remoteDirectories,
    stats: {
      ...indexStats,
      totalNodes: nodes.length,
      defaultNodeName:
        nodes.find(
          (
            node: ReturnType<typeof listStorageNodes> extends Promise<
              Array<infer Row>
            >
              ? Row
              : never,
          ) => node.isDefault,
        )?.name ?? "Not configured",
      localNodeCount: nodes.filter(
        (
          node: ReturnType<typeof listStorageNodes> extends Promise<
            Array<infer Row>
          >
            ? Row
            : never,
        ) => node.driver === "LOCAL",
      ).length,
      sftpNodeCount: nodes.filter(
        (
          node: ReturnType<typeof listStorageNodes> extends Promise<
            Array<infer Row>
          >
            ? Row
            : never,
        ) => node.driver === "SFTP",
      ).length,
    },
  };
}

// Re-export the row types that callers used to import from "./service" via the
// barrel — preserved for source compatibility.
export type { FileEntryListRow, DeletedFileEntryRow, StorageNodeListRow };
