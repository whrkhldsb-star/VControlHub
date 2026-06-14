import { prisma } from "@/lib/db";
import {
  buildSshParamsFromServer,
  execRemoteCommand,
} from "@/lib/ssh/client";
import {
  buildDirectGatewayPublicBaseUrl,
  buildInstallDirectGatewayCommand,
  buildUninstallDirectGatewayCommand,
  DIRECT_GATEWAY_DEFAULT_PORT,
} from "./direct-gateway";
import { getErrorMessage, safeRevalidatePath } from "./service-internals";

export function getConfiguredDirectAccessSecret() {
  const secret =
    process.env.STORAGE_DIRECT_ACCESS_SECRET ||
    process.env.AUTH_SECRET ||
    process.env.NEXTAUTH_SECRET ||
    "";
  if (!secret) {
    throw new Error(
      "未配置 STORAGE_DIRECT_ACCESS_SECRET，无法启用目标服务器直连。请先在运行环境中配置同一个直连签名密钥。",
    );
  }
  return secret;
}

export async function loadServerForDirectGateway(serverId: string) {
  return prisma.server.findUnique({
    where: { id: serverId },
    include: {
      sshKey: { select: { privateKey: true } },
      storageNode: {
        select: {
          id: true,
          basePath: true,
          driver: true,
          fileEntries: { select: { id: true }, take: 1 },
          mediaItems: { select: { id: true }, take: 1 },
        },
      },
    },
  });
}

export async function applyServerDirectGatewayState(input: {
  serverId: string;
  enabled: boolean;
  bestEffort?: boolean;
}) {
  const server = await loadServerForDirectGateway(input.serverId);
  if (!server) {
    if (input.bestEffort)
      return {
        enabled: input.enabled,
        publicBaseUrl: null,
        cleanupSkipped: true,
      };
    throw new Error("VPS 节点不存在或已删除");
  }
  const isLocalHost = /^(127\.0\.0\.1|localhost|::1|0\.0\.0\.0)$/i.test(
    server.host.trim(),
  );
  if (input.enabled && isLocalHost) {
    const errorMessage =
      "本机节点不需要目标服务器直连，请继续使用网站中转或本机存储访问。";
    if (input.bestEffort) {
      return {
        enabled: false,
        publicBaseUrl: null,
        cleanupSkipped: true,
        errorMessage,
      };
    }
    throw new Error(errorMessage);
  }
  if (
    input.enabled &&
    (!server.storageNode || server.storageNode.driver !== "SFTP")
  ) {
    const errorMessage =
      "目标服务器直连只能启用于已绑定 SFTP 存储节点的 VPS。请先创建或修复该 VPS 的远程存储节点。";
    if (input.bestEffort) {
      return {
        enabled: false,
        publicBaseUrl: null,
        cleanupSkipped: true,
        errorMessage,
      };
    }
    throw new Error(errorMessage);
  }
  const basePath = server.storageNode?.basePath || "/root";
  const publicBaseUrl = buildDirectGatewayPublicBaseUrl({
    host: server.host,
    port: DIRECT_GATEWAY_DEFAULT_PORT,
  });
  let cleanupSkipped = false;
  let errorMessage: string | null = null;
  let ssh: Awaited<ReturnType<typeof buildSshParamsFromServer>>;
  let command: string;
  try {
    ssh = await buildSshParamsFromServer(server, server.sshKey);
    command = input.enabled
      ? buildInstallDirectGatewayCommand({
          rootPath: basePath,
          secret: getConfiguredDirectAccessSecret(),
          port: DIRECT_GATEWAY_DEFAULT_PORT,
        })
      : buildUninstallDirectGatewayCommand();
  } catch (error) {
    if (!input.bestEffort) throw error;
    return {
      enabled: false,
      publicBaseUrl: null,
      cleanupSkipped: true,
      errorMessage: getErrorMessage(error),
    };
  }
  if (!isLocalHost) {
    try {
      const result = await execRemoteCommand({
        ...ssh,
        command,
        timeout: 180_000,
      });
      if (result.exitCode && result.exitCode !== 0)
        throw new Error(
          result.stderr || result.stdout || "目标服务器直连服务操作失败",
        );
    } catch (error) {
      if (!input.bestEffort) throw error;
      errorMessage = getErrorMessage(error);
      cleanupSkipped = true;
    }
  }
  if (input.enabled && cleanupSkipped) {
    return {
      enabled: false,
      publicBaseUrl: null,
      cleanupSkipped,
      errorMessage,
    };
  }
  await prisma.server.update({
    where: { id: input.serverId },
    data: input.enabled
      ? { fileProxyPort: DIRECT_GATEWAY_DEFAULT_PORT, publicUrl: publicBaseUrl }
      : { fileProxyPort: 0, publicUrl: null },
  });
  await prisma.storageNode.updateMany({
    where: {
      serverId: input.serverId,
      ...(input.enabled ? { driver: "SFTP" as const } : {}),
    },
    data: input.enabled
      ? {
          directAccessMode: "AUTO",
          publicBaseUrl,
          directAccessExpiresSeconds: 300,
        }
      : { directAccessMode: "PROXY", publicBaseUrl: null },
  });
  safeRevalidatePath("/servers");
  safeRevalidatePath("/storage");
  safeRevalidatePath("/files");
  return {
    enabled: input.enabled,
    publicBaseUrl: input.enabled ? publicBaseUrl : null,
    cleanupSkipped,
    errorMessage,
  };
}

export async function setServerDirectGatewayEnabled(
  serverId: string,
  enabled: boolean,
) {
  return applyServerDirectGatewayState({ serverId, enabled });
}
