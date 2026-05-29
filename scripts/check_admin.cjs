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
  const user = await prisma.user.findUnique({ where: { username: 'admin' } });
  if (user) {
    console.log('User ID:', user.id);
    console.log('Hash:', user.passwordHash);
    console.log('Active:', user.isActive);
    const match = await bcrypt.compare('0+LrKuIzTLHK4y9IAFBHDMzcGb4YxIjx', user.passwordHash);
    console.log('Default password match:', match);
  } else {
    console.log('No admin user found');
  }
  await prisma.$disconnect();
}
main().catch(e => { console.error(e); process.exit(1); });
