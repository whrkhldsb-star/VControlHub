const bcrypt = require('bcryptjs');
const { PrismaClient } = require('@prisma/client');
const { PrismaPg } = require('@prisma/adapter-pg');
const fs = require('fs');

function loadEnv() {
  const env = {};
  const content = fs.readFileSync('/opt/VControlHub/.env.runtime', 'utf8');
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;
    env[trimmed.substring(0, eqIdx)] = trimmed.substring(eqIdx + 1).replace(/^['"]|['"]$/g, '');
  }
  return env;
}

async function main() {
  const env = loadEnv();
  const adapter = new PrismaPg(env.DATABASE_URL);
  const prisma = new PrismaClient({ adapter });
  const password = env.ADMIN_INITIAL_PASSWORD || '0+LrKuIzTLHK4y9IAFBHDMzcGb4YxIjx';
  const hash = await bcrypt.hash(password, 12);
  console.log('New hash generated');
  
  const updated = await prisma.user.update({
    where: { username: 'admin' },
    data: { passwordHash: hash },
  });
  console.log('Password reset for user:', updated.username);
  console.log('New hash:', updated.passwordHash);
  
  // Verify
  const match = await bcrypt.compare(password, updated.passwordHash);
  console.log('Verification match:', match);
  
  await prisma.$disconnect();
}
main().catch(e => { console.error(e); process.exit(1); });
