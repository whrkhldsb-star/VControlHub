// Inspect the same schema and env precedence as prisma.config.ts. This command
// only reads the migration ledger. The operator applies reviewed SQL separately.
import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { config as dotenv } from "dotenv";
import { pgConnection, runBinary } from "../scripts/lib/backup-common.mjs";

// Recognise simple additive DDL only. Tokenize before classifying so comments,
// quoted identifiers, strings and multi-action ALTER statements keep their boundaries.
// Procedural SQL and unknown syntax require review, including dynamic EXECUTE.
export function isAutomaticMigration(sql) {
  const token = /\s+|--[^\r\n]*|\/\*[^]*?\*\/|"(?:[^"]|"")*"|'(?:[^'\\]|'')*'|[A-Za-z_][\w$]*|\d+(?:\.\d+)?|[(),.;:[\]+=-]/gy;
  let words = [];
  function additive() {
    if (!words.length) return true;
    const stmt = words.join(" ").replace(/ ON (?:DELETE|UPDATE) (?:SET (?:NULL|DEFAULT)|NO ACTION|CASCADE|RESTRICT)\b/g, "");
    if (!/^(?:CREATE (?:TABLE|(?:UNIQUE )?INDEX|TYPE) |ALTER TABLE .*? ADD |ALTER TYPE .*? ADD VALUE )/.test(stmt)) return false;
    return !/\b(?:DROP|DELETE|UPDATE|TRUNCATE|INSERT|MERGE|EXECUTE|CALL|SELECT|RENAME|DETACH|USING|REPLACE|INHERIT)\b/.test(stmt)
      && !/\bALTER\b/.test(stmt.replace(/^ALTER /, ""));
  }
  for (let at = 0; at < sql.length;) {
    const match = token.exec(sql);
    if (!match || match.index !== at) return false;
    at = token.lastIndex;
    const value = match[0];
    if (value.startsWith("/*")) {
      if (value.indexOf("/*", 2) !== -1) return false;
    } else if (/^\s|^--/.test(value)) {
      continue;
    } else if (value === ";") {
      if (!additive()) return false;
      words = [];
    } else {
      words.push(/^["']/.test(value) ? "?" : value.toUpperCase());
    }
  }
  return additive();
}

async function checkPending() {
  for (const file of [".env.runtime", ".env.local", ".env"]) dotenv({ path: file, quiet: true });
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required to identify pending migrations");
  const url = new URL(process.env.DATABASE_URL);
  const schema = (url.searchParams.get("schema") || "public").replaceAll('"', '""');
  const { connArgs, childEnv } = pgConnection(process.env);
  const query = `SELECT coalesce(json_agg(json_build_object('name', migration_name, 'checksum', checksum, 'done', finished_at IS NOT NULL)), '[]') FROM "${schema}"."_prisma_migrations" WHERE rolled_back_at IS NULL`;
  const { stdout } = await runBinary("psql", [...connArgs, "-XAt", "-v", "ON_ERROR_STOP=1", "-c", query], { env: childEnv });
  const applied = new Map();
  for (const row of JSON.parse(stdout)) {
    if (!row.done) throw new Error(`Unfinished migration ${row.name}`);
    applied.set(row.name, row.checksum);
  }

  const dir = path.resolve("prisma/migrations");
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name === "migration_lock.toml" && entry.isFile()) continue;
    if (!entry.isDirectory()) throw new Error(`Unexpected migration entry ${entry.name}`);
    const sql = await readFile(path.join(dir, entry.name, "migration.sql"), "utf8");
    if (applied.has(entry.name)) {
      if (applied.get(entry.name) !== createHash("sha256").update(sql).digest("hex")) throw new Error(`Changed applied migration ${entry.name}`);
      applied.delete(entry.name);
    } else if (!isAutomaticMigration(sql)) {
      throw new Error(`Pending migration ${entry.name} contains destructive or unrecognised SQL`);
    }
  }
  if (applied.size) throw new Error("Installed database contains migrations missing from this release");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  checkPending().catch(error => {
    console.error("Automatic upgrade stopped. Manual migration review and confirmation required.", error.message);
    process.exitCode = 1;
  });
}
