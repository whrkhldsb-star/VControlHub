import { readFileSync } from "node:fs";
import path from "node:path";
import { parseEnv } from "node:util";

const values = parseEnv(readFileSync(process.argv[2], "utf8"));
const runtime = process.argv.includes("--runtime");
for (const [key, value] of Object.entries(values)) {
  if (!runtime && process.env[key] !== undefined && process.env[key] !== value) {
    throw new Error(`Environment conflicts with installed configuration: ${key}`);
  }
  process.env[key] = value;
}
if (!runtime) {
  for (const key of ["DATABASE_URL", "AUTH_SESSION_SECRET", "SSH_WS_SECRET", "STORAGE_DIRECT_ACCESS_SECRET", "ARIA2_RPC_SECRET", "ENCRYPTION_KEY", "ADMIN_INITIAL_PASSWORD"]) {
    if (!values[key] || /REPLACE_WITH|CHANGE_ME|CHANGE_THIS|example\.com/i.test(values[key])) throw new Error(`Missing or placeholder: ${key}`);
  }
  for (const key of ["PORT", "NEXT_HOST", "SSH_WS_PORT"]) {
    if (process.env[key] !== undefined && values[key] === undefined) throw new Error(`Set ${key} in the installed configuration`);
  }
}
if (runtime) {
  // Existing relative data paths are relative to the checkout that was installed.
  const installRoot = process.argv[4] ?? path.dirname(path.resolve(process.argv[2]));
  for (const key of ["STORAGE_ROOT", "DOWNLOAD_ROOT", "BACKUP_DIR", "ARIA2_RPC_DIR", "FILE_VERSION_DIR",
    "MEDIA_UPLOAD_TMP_DIR", "MEDIA_THUMB_CACHE_DIR", "IMAGE_UPLOAD_DIR", "VCH_STORAGE_ROOT"]) {
    if (values[key]) values[key] = path.resolve(installRoot, values[key]);
  }
  values.PORT ??= "3000";
  values.NEXT_HOST ??= "127.0.0.1";
  values.SSH_WS_PORT ??= "3001";
}
await import("../check-aria2-secret.mjs");
process.stdout.write(JSON.stringify(values));
