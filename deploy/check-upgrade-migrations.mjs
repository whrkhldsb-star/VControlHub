// Inspect the same schema and env precedence as prisma.config.ts. This command
// only reads the migration ledger. The operator applies reviewed SQL separately.
import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { config as dotenv } from "dotenv";
import { findBinary, pgConnection, runBinary } from "../scripts/lib/backup-common.mjs";

// D-01: large append-only tables. A plain (non-CONCURRENTLY) CREATE INDEX on
// any of these takes a lock that blocks writes for the whole index build, and
// the build takes minutes once the table has months of rows: writers queue
// behind it and Compose's stop grace period cannot save an in-flight request.
// The preflight therefore surfaces these statements as structured operational
// warnings instead of silently auto-approving them.
export const LARGE_APPEND_ONLY_TABLES = [
  "audit_logs",
  "metric_snapshots",
  "traffic_snapshots",
  "job_events",
  "ai_messages",
  "notifications",
  "share_access_logs",
];

/** One CREATE INDEX statement: strip comments and collapse whitespace. */
function statementHeads(sql) {
  // Remove line and block comments, then split on top-level semicolons while
  // honouring quoted identifiers and strings (a literal ';' in a default value
  // must not split a statement).
  const heads = [];
  let current = "";
  let quote = null;
  let blockComment = false;
  for (let i = 0; i < sql.length; i++) {
    const char = sql[i];
    const next = sql[i + 1];
    if (blockComment) {
      if (char === "*" && next === "/") { blockComment = false; i++; }
      continue;
    }
    if (!quote && char === "-" && next === "-") {
      while (i < sql.length && sql[i] !== "\n") i++;
      continue;
    }
    if (!quote && char === "/" && next === "*") { blockComment = true; i++; continue; }
    if (quote) {
      current += char;
      if (char === quote) {
        if (next === quote) { current += next; i++; }
        else quote = null;
      }
      continue;
    }
    if (char === '"' || char === "'") { quote = char; current += char; continue; }
    if (char === ";") { heads.push(current); current = ""; continue; }
    current += char;
  }
  if (current.trim()) heads.push(current);
  return heads.map((head) => head.replace(/\s+/g, " ").trim()).filter(Boolean);
}

// Matches "CREATE [UNIQUE] INDEX [IF NOT EXISTS] [name] [IF NOT EXISTS] ON [ONLY] table(" or "... table ("
const indexTarget = /^CREATE (?:UNIQUE )?INDEX (?:IF NOT EXISTS )?(?:(?:"[^"]+"|[A-Za-z_][\w$]*) )?(?:IF NOT EXISTS )?ON (?:ONLY )?([^ (]+)[ (]/i;
const concurrentIndexHead = /^CREATE (?:UNIQUE )?INDEX CONCURRENTLY\b/i;

/**
 * Structured operational warning for a plain CREATE INDEX on a known large
 * append-only table. One entry per (migration, statement); the preflight
 * prints each entry without failing, so additive migrations keep
 * auto-approving; the operator decides whether to pre-create the index
 * CONCURRENTLY before the upgrade (see docs/ci-gates.md).
 */
export function largeIndexWarnings(sql, migrationName) {
  const warnings = [];
  for (const head of statementHeads(sql)) {
    if (concurrentIndexHead.test(head)) continue;
    const match = indexTarget.exec(head);
    if (!match) continue;
    // Last dotted component of the (possibly schema-qualified, possibly
    // quoted) table name, normalised for the allow-list comparison.
    const table = match[1].replaceAll('"', "").split(".").pop().toLowerCase();
    if (LARGE_APPEND_ONLY_TABLES.includes(table)) {
      warnings.push({
        migration: migrationName,
        table,
        statement: head.slice(0, 200),
        reason: "plain CREATE INDEX on a large append-only table blocks writes for the whole index build",
      });
    }
  }
  return warnings;
}

// The tokenizer represents quoted identifiers and strings by their opening quote.
const identifier = /(?:[A-Z_][\w$]*|")/.source;
const tableHeader = new RegExp(`^ALTER TABLE (?:IF EXISTS )?(?:ONLY )?${identifier}(?: \\. ${identifier})* `);
const addColumn = new RegExp(`^ADD COLUMN (?:IF NOT EXISTS )?${identifier} ${identifier}(?: |$)`);
function isAdditiveTableAction(action) {
  if (!addColumn.test(action)) return false;
  // Column-level constraints can restrict the old writer just like ADD CONSTRAINT.
  if (/ (?:CHECK|PRIMARY KEY|UNIQUE|EXCLUDE|REFERENCES)(?: |$)/.test(action)) return false;
  if (!/ NOT NULL(?: |$)/.test(action)) return true;
  // A rolled-back application omits this column on INSERT.
  return / DEFAULT /.test(action) && !/ DEFAULT (?:\( )*NULL(?: |$)/.test(action);
}

function hasOnlyAdditiveTableActions(words) {
  const closing = [];
  let start = 0;
  for (let i = 0; i <= words.length; i++) {
    const word = words[i];
    if (word === "(") closing.push(")");
    else if (word === "[") closing.push("]");
    else if (word === ")" || word === "]") {
      if (closing.pop() !== word) return false;
    } else if (i === words.length || (word === "," && closing.length === 0)) {
      let action = words.slice(start, i).join(" ");
      if (start === 0) action = action.replace(tableHeader, "");
      if (!isAdditiveTableAction(action)) return false;
      start = i + 1;
    }
  }
  return closing.length === 0;
}

// Preserve identifier spelling for proofs involving a table created earlier
// in this migration. IF NOT EXISTS could refer to an existing object.
function tableName(tokens, start) {
  const parts = [];
  let at = start;
  while (/^(?:[A-Za-z_][\w$]*|"(?:[^"]|"")*")$/.test(tokens[at] ?? "")) {
    const value = tokens[at++];
    parts.push(value.startsWith('"') ? value.slice(1, -1).replaceAll('""', '"') : value.toLowerCase());
    if (tokens[at] !== ".") break;
    at++;
  }
  return { key: JSON.stringify(parts), next: at };
}

// Recognise simple additive DDL only. Tokenize before classifying so comments,
// quoted identifiers, strings and multi-action ALTER statements keep their boundaries.
// Procedural SQL and unknown syntax require review, including dynamic EXECUTE.
export function isAutomaticMigration(sql) {
  const token = /\s+|--[^\r\n]*|\/\*[^]*?\*\/|"(?:[^"]|"")*"|'(?:[^'\\]|'')*'|[A-Za-z_][\w$]*|\d+(?:\.\d+)?|[(),.;:[\]+=-]/gy;
  let words = [];
  let raw = [];
  const newTables = new Set();
  function additive() {
    if (!words.length) return true;
    const stmt = words.join(" ").replace(/ ON (?:DELETE|UPDATE) (?:SET (?:NULL|DEFAULT)|NO ACTION|CASCADE|RESTRICT)\b/g, "");
    if (words[0] === "ALTER" && words[1] === "TABLE") {
      if (!hasOnlyAdditiveTableActions(words)) return false;
    } else if (stmt.startsWith("CREATE UNIQUE INDEX ")) {
      const table = tableName(raw, words.indexOf("ON") + 1);
      if (!newTables.has(table.key) || raw[table.next] !== "(") return false;
    } else if (!/^(?:CREATE (?:TABLE|INDEX|TYPE) |ALTER TYPE .*? ADD VALUE )/.test(stmt)) return false;
    if (words[0] === "CREATE" && words[1] === "TABLE") {
      const table = tableName(raw, 2);
      for (let i = 0; i < words.length; i++) {
        if (words[i] !== "REFERENCES") continue;
        const ref = tableName(raw, i + 1);
        if (ref.key !== table.key && !newTables.has(ref.key)) return false;
      }
      if (words[2] !== "IF" && raw[table.next] === "(") newTables.add(table.key);
    }
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
      raw = [];
    } else {
      raw.push(value);
      words.push(/^["']/.test(value) ? value[0] : value.toUpperCase());
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
  const schemaName = (url.searchParams.get("schema") || "public").replaceAll("'", "''");
  const inspect = `SELECT CASE
    WHEN to_regclass(format('%I.%I', '${schemaName}', '_prisma_migrations')) IS NOT NULL THEN 'ledger'
    WHEN EXISTS (SELECT FROM pg_catalog.pg_namespace n JOIN pg_catalog.pg_depend d
      ON d.refclassid = 'pg_catalog.pg_namespace'::regclass AND d.refobjid = n.oid
      WHERE n.nspname <> 'information_schema' AND n.nspname !~ '^pg_')
      OR EXISTS (SELECT FROM pg_catalog.pg_largeobject_metadata) THEN 'untracked'
    ELSE 'empty' END`;
  const psql = await findBinary("psql");
  if (!psql) throw new Error("PostgreSQL client psql is required to inspect the target database");
  const read = query => runBinary(psql, [...connArgs, "-XAt", "-v", "ON_ERROR_STOP=1", "-c", query], { env: childEnv });
  const state = (await read(inspect)).stdout.trim();
  if (state === "empty") return;
  if (state !== "ledger") throw new Error("Target database is not empty and the selected schema has no migration ledger");
  const query = `SELECT coalesce(json_agg(json_build_object('name', migration_name, 'checksum', checksum, 'done', finished_at IS NOT NULL)), '[]') FROM "${schema}"."_prisma_migrations" WHERE rolled_back_at IS NULL`;
  const { stdout } = await read(query);
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
    } else {
      // Additive and auto-approved: still warn about plain CREATE INDEX
      // statements that will lock large append-only tables for the build.
      for (const warning of largeIndexWarnings(sql, entry.name)) {
        console.warn(`[upgrade-preflight] index-lock-warning ${JSON.stringify(warning)}`);
      }
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
