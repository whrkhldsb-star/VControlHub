import { Prisma, PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

/**
 * Turn two-factor authentication off for one account — for an owner who lost both the authenticator and
 * the recovery codes (the app has no other way back in: `2fa/disable` itself needs a code).
 *
 *   npm run admin:reset-2fa -- <username>
 *
 * The account's sessions are ended (the session epoch advances) and the reset is written to the audit log.
 */
async function reset2fa() {
  const username = process.argv[2]?.trim();
  if (!username) {
    console.error("Usage: npm run admin:reset-2fa -- <username>");
    process.exitCode = 2;
    return;
  }
  const adapter = new PrismaPg(process.env.DATABASE_URL!);
  const prisma = new PrismaClient({ adapter });
  try {
    const user = await prisma.user.findUnique({
      where: { username },
      select: { id: true, twoFactorEnabled: true, teamMembership: { select: { teamId: true } } },
    });
    if (!user) {
      console.error(`No account named "${username}"`);
      process.exitCode = 1;
      return;
    }
    await prisma.$transaction([
      prisma.user.update({
        where: { id: user.id },
        data: {
          twoFactorEnabled: false,
          twoFactorSecret: null,
          twoFactorRecoveryCodes: Prisma.DbNull,
          sessionEpoch: { increment: 1 },
        },
      }),
      prisma.auditLog.create({
        data: {
          actorType: "SYSTEM",
          action: "auth.2fa_reset_cli",
          severity: "CRITICAL",
          detail: { targetUsername: username, hadTwoFactor: user.twoFactorEnabled },
          teamId: user.teamMembership?.teamId ?? null,
        },
      }),
    ]);
    console.log(`Two-factor authentication reset for ${username}${user.twoFactorEnabled ? "" : " (it was not enabled)"}`);
  } finally {
    await prisma.$disconnect();
  }
}

reset2fa().catch((error) => {
  console.error(error);
  process.exit(1);
});
