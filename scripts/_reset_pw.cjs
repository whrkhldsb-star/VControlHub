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
  const url = new URL(process.env.DATABASE_URL);
  url.searchParams.set('pool_max', '2');
  const adapter = new PrismaPg(url.toString());
  const db = new PrismaClient({ adapter });
  
  const pw = '0+LrKuIzTLHK4y9IAFBHDMzcGb4YxIjx';
  const hash = await bcrypt.hash(pw, 12);
  console.log('New hash prefix:', hash.substring(0, 15));
  
  await db.user.update({
    where: { username: 'admin' },
    data: { passwordHash: hash },
  });
  console.log('Admin password updated successfully');
  
  // Verify
  const user = await db.user.findUnique({ where: { username: 'admin' } });
  const ok = await bcrypt.compare(pw, user.passwordHash);
  console.log('Verification match:', ok);
  
  await db.$disconnect();
}
main().catch(e => { console.error(e.message); process.exit(1); });
