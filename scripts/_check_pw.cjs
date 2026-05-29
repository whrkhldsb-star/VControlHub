const { PrismaClient } = require('@prisma/client');
const { PrismaPg } = require('@prisma/adapter-pg');
const bcrypt = require('bcryptjs');
const fs = require('fs');
const path = require('path');

// Load .env.local
const envPath = path.join(__dirname, '..', '.env.local');
const envContent = fs.readFileSync(envPath, 'utf8');
for (const line of envContent.split('\n')) {
  const m = line.match(/^([A-Z_]+)=["']?([^"'\n]+)["']?$/);
  if (m) process.env[m[1]] = m[2];
}

async function main() {
  const dbUrl = process.env.DATABASE_URL;
  console.log('DB URL prefix:', dbUrl?.substring(0, 30));
  const url = new URL(dbUrl);
  url.searchParams.set('pool_max', '2');
  const adapter = new PrismaPg(url.toString());
  const db = new PrismaClient({ adapter });
  
  const user = await db.user.findUnique({ where: { username: 'admin' } });
  if (!user) { console.log('No user found'); process.exit(1); }
  console.log('User id:', user.id, 'enabled:', user.enabled);
  const pw = '0+LrKuIzTLHK4y9IAFBHDMzcGb4YxIjx';
  const ok = await bcrypt.compare(pw, user.passwordHash);
  console.log('Password match:', ok);
  console.log('Hash prefix:', user.passwordHash.substring(0, 10));
  await db.$disconnect();
}
main().catch(e => { console.error(e.message); process.exit(1); });
