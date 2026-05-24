import { hashPassword } from "@/lib/auth/password";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

async function resetPassword() {
  const nextPassword = process.argv[2] ?? "Admin@2026changeMe!";
  const adapter = new PrismaPg(process.env.DATABASE_URL!);
  const prisma = new PrismaClient({ adapter });
  const hash = await hashPassword(nextPassword);
  await prisma.user.update({
    where: { username: "admin" },
    data: {
      passwordHash: hash,
      mustChangePassword: true,
      status: "PENDING_PASSWORD_RESET",
    },
  });
  console.log(`Password updated successfully for admin`);
  await prisma.$disconnect();
}

resetPassword().catch((e) => {
  console.error(e);
  process.exit(1);
});
