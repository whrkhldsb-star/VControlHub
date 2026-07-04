/**
 * Server Uptime 收集器
 * 每天汇总前一天的 uptime 数据并存储到 server_uptime_snapshots 表
 */
import { PrismaClient } from "@prisma/client";
import { createLogger } from "@/lib/logging";

const prisma = new PrismaClient();
const logger = createLogger("uptime:aggregate");

/**
 * 计算某台服务器某天的 uptime
 * 基于 MetricSnapshot.isOnline 字段
 */
async function calculateServerUptime(serverId: string, date: Date) {
  // 使用 UTC 00:00:00 作为 date
  const dayStart = new Date(date);
  dayStart.setUTCHours(0, 0, 0, 0);
  const dayEnd = new Date(dayStart);
  dayEnd.setUTCDate(dayEnd.getUTCDate() + 1);

  // 查询当天的所有 MetricSnapshot
  const snapshots = await prisma.metricSnapshot.findMany({
    where: {
      serverId,
      createdAt: {
        gte: dayStart,
        lt: dayEnd,
      },
    },
    orderBy: { createdAt: "asc" },
    take: 5000,
  });

  if (snapshots.length === 0) {
    return {
      uptimePercent: 0,
      onlineMinutes: 0,
      offlineMinutes: 1440,
      checkCount: 0,
    };
  }

  const onlineCount = snapshots.filter((s) => s.isOnline).length;
  const offlineCount = snapshots.length - onlineCount;

  const intervalMinutes = 1440 / snapshots.length;
  const onlineMinutes = Math.round(onlineCount * intervalMinutes);
  const offlineMinutes = Math.round(offlineCount * intervalMinutes);

  const uptimePercent = (onlineCount / snapshots.length) * 100;

  return {
    uptimePercent: Math.round(uptimePercent * 100) / 100,
    onlineMinutes,
    offlineMinutes,
    checkCount: snapshots.length,
  };
}

/**
 * 汇总所有服务器某天的 uptime
 */
async function aggregateDailyUptimes(date: Date = new Date(Date.now() - 86400000)) {
  const servers = await prisma.server.findMany({
    where: { enabled: true },
    select: { id: true, name: true },
    take: 500,
  });

  const dateStr = date.toISOString().split("T")[0];
  logger.info("Aggregating uptime", { serverCount: servers.length, date: dateStr });

  for (const server of servers) {
    const stats = await calculateServerUptime(server.id, date);

    await prisma.serverUptimeSnapshot.upsert({
      where: {
        serverId_date: {
          serverId: server.id,
          date: new Date(dateStr + "T00:00:00.000Z"),
        },
      },
      create: {
        serverId: server.id,
        date: new Date(dateStr + "T00:00:00.000Z"),
        ...stats,
      },
      update: stats,
    });

    logger.debug("Server uptime aggregated", {
      server: server.name,
      uptimePercent: stats.uptimePercent,
      onlineMinutes: stats.onlineMinutes,
      offlineMinutes: stats.offlineMinutes,
    });
  }
}

/**
 * 主函数
 */
async function main() {
  const dateArg = process.argv[2];
  const date = dateArg ? new Date(dateArg) : new Date(Date.now() - 86400000);

  if (isNaN(date.getTime())) {
    logger.error("Invalid date format. Use YYYY-MM-DD");
    process.exit(1);
  }

  try {
    await aggregateDailyUptimes(date);
    logger.info("Uptime aggregation completed");
  } catch (err) {
    logger.error("Aggregation failed", err);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main();