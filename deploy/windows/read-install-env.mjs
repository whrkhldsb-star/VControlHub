import { readFileSync } from "node:fs";
import { parseEnv } from "node:util";
import "../check-aria2-secret.mjs";

for (const key of ["DATABASE_URL", "AUTH_SESSION_SECRET", "SSH_WS_SECRET", "STORAGE_DIRECT_ACCESS_SECRET", "ARIA2_RPC_SECRET", "ENCRYPTION_KEY", "ADMIN_INITIAL_PASSWORD"]) {
  const value = process.env[key];
  if (!value || /REPLACE_WITH|CHANGE_ME|CHANGE_THIS|example\.com/i.test(value)) throw new Error(`Missing or placeholder: ${key}`);
}
const names = Object.keys(parseEnv(readFileSync(process.argv[2], "utf8")));
process.stdout.write(JSON.stringify(Object.fromEntries(names.map(name => [name, process.env[name]]))));
