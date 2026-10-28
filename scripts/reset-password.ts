import { hashPassword } from "@/lib/auth/password";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

/**
 * Reset the platform administrator's password:
 *
 *   npm run admin:reset-password -- '<new password, 8-128 characters>'
 *
 * There is deliberately no default: a fixed password written in the source would be known to anyone who
 * reads the repository. The account must change the password at its next sign-in.
 */
async function resetPassword() {
  const nextPassword = process.argv[2];
  if (!nextPassword || nextPassword.length < 8 || nextPassword.length > 128) {
    console.error("Usage: npm run admin:reset-password -- '<new password, 8-128 characters>'");
    process.exitCode = 2;
    return;
  }
  const adapter = new PrismaPg(process.env.DATABASE_URL!);
  const prisma = new PrismaClient({ adapter });
  try {
    const hash = await hashPassword(nextPassword);
    await prisma.user.update({
      where: { username: "admin" },
      data: {
        passwordHash: hash,
        mustChangePassword: true,
        status: "PENDING_PASSWORD_RESET",
        sessionEpoch: { increment: 1 },
      },
    });
    console.log("Password updated successfully for admin");
  } finally {
    await prisma.$disconnect();
  }
}

resetPassword().catch((e) => {
  console.error(e);
  process.exit(1);
});
