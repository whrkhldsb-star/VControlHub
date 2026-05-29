const bcrypt = require('bcryptjs');
const fs = require('fs');

// Parse .env.runtime manually
function loadEnv() {
  const env = {};
  const content = fs.readFileSync('/opt/VControlHub/.env.runtime', 'utf8');
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;
    const key = trimmed.substring(0, eqIdx);
    let value = trimmed.substring(eqIdx + 1);
    // Remove surrounding quotes
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    env[key] = value;
  }
  return env;
}

const { PrismaClient } = require('@prisma/client');
const { PrismaPg } = require('@prisma/adapter-pg');

async function main() {
  const env = loadEnv();
  const dbUrl = env.DATABASE_URL;
  console.log('DB URL loaded:', dbUrl ? 'yes' : 'no');
  console.log('DB URL length:', dbUrl ? dbUrl.length : 0);
  
  const url = new URL(dbUrl);
  const adapter = new PrismaPg(url.toString());
  const prisma = new PrismaClient({ adapter });
  
  const newPassword = 'admin2xvjl2cp';
  const hash = await bcrypt.hash(newPassword, 12);
  console.log('Generated hash length:', hash.length);
  
  const user = await prisma.user.update({
    where: { username: 'admin' },
    data: { passwordHash: hash },
  });
  
  console.log('Updated user:', user.username);
  
  // Verify
  const storedUser = await prisma.user.findUnique({
    where: { username: 'admin' },
  });
  console.log('Stored hash length:', storedUser.passwordHash.length);
  
  const matches = await bcrypt.compare(newPassword, storedUser.passwordHash);
  console.log('Password verification:', matches ? 'OK' : 'FAILED');
  
  await prisma.$disconnect();
}

main().catch(e => { console.error(e); process.exit(1); });
