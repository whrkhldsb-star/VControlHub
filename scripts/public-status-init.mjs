#!/usr/bin/env node
/**
 * Open the public status board on an installation that has never configured
 * it — with nothing published.
 *
 *   ENV_FILE=/opt/VControlHub/.env.runtime node scripts/public-status-init.mjs [--title VControlHub] [--dry-run]
 *
 * - Only acts when no `public_status_sites` row exists. An existing row (open
 *   or deliberately closed) is left untouched and reported.
 * - Creates the row with enabled=true, the given title, platform status
 *   hidden and every metric category; no description/announcement.
 * - Never creates or changes `public_status_nodes`: every server stays
 *   private until an administrator publishes it on /public-status.
 * - Writes a SYSTEM audit record (`public_status.site.initialize`) in the
 *   same transaction. Prints no connection details or secrets.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

import { readEnvFile } from "./lib/backup-common.mjs";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const APP_DIR = process.env.APP_DIR?.trim() || path.resolve(SCRIPT_DIR, "..");
const ENV_FILE = process.env.ENV_FILE?.trim() || path.join(APP_DIR, ".env.local");
const METRICS = ["cpu", "memory", "disk", "network", "traffic", "uptime", "load", "latency", "availability"];

function argument(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const title = (argument("--title") ?? "VControlHub").trim().slice(0, 80) || "VControlHub";
  const env = { ...((await readEnvFile(ENV_FILE)) ?? {}), ...process.env };
  if (!env.DATABASE_URL) throw new Error("DATABASE_URL is not set (ENV_FILE or environment)");
  const client = new pg.Client({ connectionString: env.DATABASE_URL });
  await client.connect();
  try {
    await client.query("BEGIN");
    // Serialise concurrent runs; a row created meanwhile is then respected.
    await client.query("SELECT pg_advisory_xact_lock(hashtext('public_status_sites.initialize'))");
    const existing = await client.query(`SELECT enabled, "updatedAt" FROM public_status_sites WHERE id = 'default'`);
    const published = await client.query(`SELECT count(*)::int AS n FROM public_status_nodes WHERE published`);
    if (existing.rowCount > 0) {
      await client.query("ROLLBACK");
      console.log(JSON.stringify({ action: "none", reason: "site already configured", enabled: existing.rows[0].enabled, updatedAt: existing.rows[0].updatedAt, publishedNodes: published.rows[0].n }));
      return;
    }
    if (dryRun) {
      await client.query("ROLLBACK");
      console.log(JSON.stringify({ action: "would-initialize", title, enabled: true, showPlatformStatus: false, publishedNodes: published.rows[0].n }));
      return;
    }
    await client.query(
      `INSERT INTO public_status_sites (id, enabled, title, description, announcement, "defaultView", "refreshSeconds", accent, metrics, "showPlatformStatus", "updatedById", "createdAt", "updatedAt")
       VALUES ('default', TRUE, $1, NULL, NULL, 'cards', 15, 'default', $2::text[], FALSE, NULL, now() AT TIME ZONE 'UTC', now() AT TIME ZONE 'UTC')`,
      [title, METRICS],
    );
    await client.query(
      `INSERT INTO audit_logs (id, "actorType", "actorId", action, severity, detail, "createdAt")
       VALUES ($1, 'SYSTEM', NULL, 'public_status.site.initialize', 'WARNING', $2::jsonb, now() AT TIME ZONE 'UTC')`,
      [
        `psinit${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`,
        JSON.stringify({
          enabled: true,
          title,
          showPlatformStatus: false,
          publishedNodes: published.rows[0].n,
          reason: "Open the sign-in-free status board with no node published (operator-approved initialization); servers stay private until published on /public-status.",
        }),
      ],
    );
    await client.query("COMMIT");
    console.log(JSON.stringify({ action: "initialized", title, enabled: true, showPlatformStatus: false, publishedNodes: published.rows[0].n }));
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(`public-status-init failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
