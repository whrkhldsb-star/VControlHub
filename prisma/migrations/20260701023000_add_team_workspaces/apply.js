const { Client } = require("pg");
const fs = require("fs");
require("dotenv").config({ path: ".env.local" });

async function main() {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  const sql = fs.readFileSync("prisma/migrations/20260701023000_add_team_workspaces/migration.sql", "utf8");
  await client.query(sql);
  await client.end();
  console.log("team workspace migration applied");
}
main().catch((err) => {
  console.error(err);
  process.exit(1);
});
