// Compare the actual archive bytes to the COPY rows of its own pg_dump snapshot.
// A second live database query can see a different set of rows after an upload.
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { createGunzip } from "node:zlib";
import tar from "tar-stream";

const tables = {
  StorageNode: ["id", "driver", "basePath"],
  file_entries: ["storageNodeId", "relativePath", "entryType", "isDeleted", "deleteBatchId", "size", "checksumSha256"],
  media_items: ["storageNodeId", "relativePath", "size"],
  file_versions: ["blobRelativePath", "sizeBytes", "checksumSha256"],
  image_uploads: ["storageKey", "sizeBytes", "checksum"],
};
const optionalColumns = {
  file_entries: ["deletedAgentRoot", "storageVersion"],
};

function copyValue(value) {
  if (value === "\\N") return null;
  // pg_dump's text COPY uses these escapes for delimiters and backslashes.
  const escapes = { b: "\b", f: "\f", n: "\n", r: "\r", t: "\t", v: "\v", "\\": "\\" };
  return value.replace(/\\([bfnrtv\\])/g, (_, c) => escapes[c]);
}

// SQL large objects and COPY rows of unrelated tables can be much larger
// than a storage index row. Discard an oversized line as it streams past.
async function* dumpLines(source) {
  const limit = 8 * 1024 * 1024;
  let length = 0;
  let parts = [];
  for await (const chunk of source) {
    let start = 0;
    while (start < chunk.length) {
      const newline = chunk.indexOf(10, start);
      const end = newline < 0 ? chunk.length : newline;
      length += end - start;
      if (length <= limit) parts.push(chunk.subarray(start, end));
      else parts = [];
      if (newline < 0) break;
      yield length <= limit ? Buffer.concat(parts, length).toString("utf8").replace(/\r$/, "") : null;
      length = 0;
      parts = [];
      start = newline + 1;
    }
  }
  if (length) throw new Error("Incomplete backup: unterminated pg_dump line");
}

async function readDumpReferences(dump, schema) {
  const data = Object.fromEntries(Object.keys(tables).map((table) => [table, []]));
  const seen = new Set();
  let complete = false;
  const dumpHash = createHash("sha256");
  await pipeline(createReadStream(dump), async function* (compressed) {
    for await (const chunk of compressed) {
      dumpHash.update(chunk);
      yield chunk;
    }
  }, createGunzip(), async (source) => {
    let copy = null;
    for await (const line of dumpLines(source)) {
      if (line === null) {
        if (copy?.table) throw new Error(`Cannot verify oversized database file-index row in ${copy.table}`);
        continue;
      }
      if (copy) {
        if (line === "\\.") copy = null;
        else if (copy.table) {
          const values = line.split("\t");
          data[copy.table].push(Object.fromEntries(copy.fields.map(([field, index]) => [field, copyValue(values[index])])));
        }
      } else if (line.startsWith("COPY ")) {
        // Other tables can contain text beginning with "COPY" as well.
        copy = {};
        const match = /^COPY ("(?:[^"]|"")*"|[^.\s]+)\.("?[\w]+"?) \(([^)]+)\) FROM stdin;$/.exec(line);
        if (!match || match[1].replace(/^"|"$/g, "").replaceAll('""', '"') !== schema) continue;
        const table = match[2].replaceAll('"', "");
        if (!Object.hasOwn(tables, table)) continue;
        const columns = match[3].split(", ").map((column) => column.replaceAll('"', ""));
        const required = tables[table].map((field) => [field, columns.indexOf(field)]);
        if (required.some(([, index]) => index < 0)) throw new Error(`Incomplete backup: unexpected COPY columns for ${table}`);
        const optional = (optionalColumns[table] || []).map((field) => [field, columns.indexOf(field)]).filter(([, index]) => index >= 0);
        copy = { table, fields: [...required, ...optional] };
        seen.add(table);
      } else if (line === "-- PostgreSQL database dump complete") complete = true;
    }
  });
  if (!complete || !seen.has("StorageNode") || !seen.has("file_entries")) throw new Error("Incomplete backup: the dump lacks the storage index or completion marker");
  return { data, dumpChecksum: dumpHash.digest("hex") };
}

export async function expectedArchiveFiles(dump, env, appDir, roots, versionRoot, expandRoot) {
  const schema = (env.DATABASE_URL && new URL(env.DATABASE_URL).searchParams.get("schema")) || "public";
  const { data, dumpChecksum } = await readDumpReferences(dump, schema);
  const nodes = new Map(data.StorageNode.map((node) => [node.id, node]));
  const expected = new Map();
  function add(base, relative, size, checksum) {
    const file = path.resolve(base, relative);
    const parent = path.relative(base, file);
    if (!parent || parent === ".." || parent.startsWith(`..${path.sep}`) || path.isAbsolute(parent)) throw new Error("Incomplete backup: database references a file outside its storage root");
    const root = roots.find(({ directory }) => file.startsWith(`${directory}${path.sep}`));
    if (!root) throw new Error(`Incomplete backup: database file is outside archive coverage: ${file}`);
    const member = path.posix.join(root.member, path.relative(root.directory, file).split(path.sep).join("/"));
    const previous = expected.get(member);
    if (previous && ((size && previous.size && size !== previous.size) || (checksum && previous.checksum && checksum !== previous.checksum))) {
      throw new Error(`Incomplete backup: conflicting database references for ${member}`);
    }
    expected.set(member, { size: size ?? previous?.size, checksum: checksum ?? previous?.checksum });
  }
  for (const row of [...data.file_entries, ...data.media_items]) {
    // A manual recycle of an existing LOCAL file records deletedAgentRoot and
    // a live storageVersion while keeping its body on disk. Sync tombstones
    // (pruneStaleEntries / legacy backfills without deletedAgentRoot),
    // retired-root tombstones, and recycles of already-absent files have no
    // backing body to verify on disk.
    if (row.entryType) {
      if (row.entryType !== "FILE") continue;
      if (row.isDeleted === "t") {
        if (!row.deleteBatchId) continue;
        if (Object.hasOwn(row, "deletedAgentRoot") && (!row.deletedAgentRoot || row.deletedAgentRoot === "retired-root")) continue;
        if (Object.hasOwn(row, "storageVersion") && row.storageVersion === "absent") continue;
      }
    }
    const node = nodes.get(row.storageNodeId);
    if (!node) throw new Error("Incomplete backup: file references an unknown storage node");
    if (node.driver === "LOCAL") add(expandRoot(node.basePath, env), row.relativePath, row.size, row.checksumSha256);
  }
  for (const row of data.file_versions) add(versionRoot, row.blobRelativePath, row.sizeBytes, row.checksumSha256);
  for (const row of data.image_uploads) add(path.resolve(appDir, env.IMAGE_UPLOAD_DIR || "uploads/image-bed"), row.storageKey, row.sizeBytes, row.checksum);
  return { expected, dumpChecksum };
}

export async function verifyArchiveFiles(archive, { expected, dumpChecksum }, integrityMember) {
  const extraction = tar.extract();
  const count = expected.size;
  const seen = new Set();
  expected.set("database.sql.gz", { checksum: dumpChecksum });
  expected.set(integrityMember, {});
  await Promise.all([
    pipeline(createReadStream(archive), createGunzip(), extraction),
    (async () => {
      for await (const entry of extraction) {
        const { name, type, size } = entry.header;
        if (type !== "file" && type !== "directory") throw new Error(`The backup holds an entry the restore cannot take back: ${name}`);
        const reference = expected.get(name);
        if (!reference) { entry.resume(); continue; }
        if (type !== "file" || (reference.size != null && BigInt(reference.size) !== BigInt(size))) throw new Error(`Incomplete backup: size mismatch for ${name}`);
        if (reference.checksum) {
          const hash = createHash("sha256");
          for await (const chunk of entry) hash.update(chunk);
          if (hash.digest("hex") !== reference.checksum.toLowerCase()) throw new Error(`Incomplete backup: checksum mismatch for ${name}`);
        } else entry.resume();
        seen.add(name);
      }
    })(),
  ]);
  if (seen.size !== expected.size) {
    const missing = [...expected.keys()].find((name) => !seen.has(name));
    throw new Error(`Incomplete backup: missing ${expected.size - seen.size} referenced file(s), including ${missing}`);
  }
  return count;
}
