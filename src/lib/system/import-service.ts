/**
 * TR-042: 系统配置导入服务
 *
 * 按依赖顺序事务性 upsert，支持 dryRun 预览（不写入）。
 * 敏感字段（passwordHash/privateKey/apiKey 等）在导出时已置 null，
 * 导入后需用户手动重新设置。
 *
 * 依赖顺序：
 *  Permission → Role → RolePermission
 *  → User → UserRole
 *  → SshKey → Server
 *  → StorageNode → UserStorageAccess
 *  → CommandTemplate → QuickService → Playbook → AlertRule
 *  → Setting → AiProvider → Announcement → Snippet
 */

import { Prisma } from "@prisma/client";

import { prisma } from "@/lib/db";
import type { ExportFile, ImportOptions, ImportPreview } from "@/lib/system/config-schema";

// ── 工具函数 ──────────────────────────────────────────────

function parseDate(s: string): Date {
  return new Date(s);
}

function parseBigInt(s: string | null): bigint | null {
  if (s === null || s === "") return null;
  try {
    return BigInt(s);
  } catch {
    return null;
  }
}

// ── 预览模式 ──────────────────────────────────────────────

/**
 * 计算 dryRun 预览：对每张表统计将创建/更新/跳过多少条记录，
 * 不实际写入数据库。
 */
export async function previewImport(
  file: ExportFile,
  options: ImportOptions,
): Promise<ImportPreview> {
  const t = file.tables;
  const summary: ImportPreview["summary"] = {};
  const warnings: string[] = [];
  let totalRecords = 0;

  // ── Permissions ──
  {
    let create = 0, update = 0, skip = 0;
    for (const r of t.permissions) {
      const existing = await prisma.permission.findUnique({ where: { id: r.id } });
      if (existing) { if (options.overwriteExisting) update++; else skip++; }
      else create++;
    }
    summary["权限"] = { create, update, skip };
    totalRecords += create + update;
  }

  // ── Roles ──
  {
    let create = 0, update = 0, skip = 0;
    for (const r of t.roles) {
      const existing = await prisma.role.findUnique({ where: { id: r.id } });
      if (existing) { if (options.overwriteExisting) update++; else skip++; }
      else create++;
    }
    summary["角色"] = { create, update, skip };
    totalRecords += create + update;
  }

  // ── RolePermissions ──
  {
    let create = 0; const update = 0; let skip = 0;
    for (const r of t.rolePermissions) {
      const existing = await prisma.rolePermission.findUnique({
        where: { roleId_permissionId: { roleId: r.roleId, permissionId: r.permissionId } },
      });
      if (existing) skip++;
      else create++;
    }
    summary["角色权限"] = { create, update, skip };
    totalRecords += create;
  }

  // ── Users ──
  {
    let create = 0, update = 0, skip = 0;
    if (options.importUsers) {
      for (const r of t.users) {
        const existing = await prisma.user.findUnique({ where: { id: r.id } });
        if (existing) { if (options.overwriteExisting) update++; else skip++; }
        else create++;
      }
    } else {
      skip = t.users.length;
      warnings.push("已跳过用户导入（按选项设置）");
    }
    summary["用户"] = { create, update, skip };
    totalRecords += create + update;
  }

  // ── UserRoles ──
  {
    let create = 0; const update = 0; let skip = 0;
    for (const r of t.userRoles) {
      const existing = await prisma.userRole.findUnique({
        where: { userId_roleId: { userId: r.userId, roleId: r.roleId } },
      });
      if (existing) skip++;
      else create++;
    }
    summary["用户角色"] = { create, update, skip };
    totalRecords += create;
  }

  // ── SshKeys ──
  {
    let create = 0, update = 0, skip = 0;
    for (const r of t.sshKeys) {
      const existing = await prisma.sshKey.findUnique({ where: { id: r.id } });
      if (existing) { if (options.overwriteExisting) update++; else skip++; }
      else create++;
    }
    summary["SSH 密钥"] = { create, update, skip };
    totalRecords += create + update;
  }

  // ── Servers ──
  {
    let create = 0, update = 0, skip = 0;
    for (const r of t.servers) {
      const existing = await prisma.server.findUnique({ where: { id: r.id } });
      if (existing) { if (options.overwriteExisting) update++; else skip++; }
      else create++;
    }
    summary["服务器"] = { create, update, skip };
    totalRecords += create + update;
  }

  // ── StorageNodes ──
  {
    let create = 0, update = 0, skip = 0;
    for (const r of t.storageNodes) {
      const existing = await prisma.storageNode.findUnique({ where: { id: r.id } });
      if (existing) { if (options.overwriteExisting) update++; else skip++; }
      else create++;
    }
    summary["存储节点"] = { create, update, skip };
    totalRecords += create + update;
  }

  // ── UserStorageAccess ──
  {
    let create = 0, update = 0, skip = 0;
    for (const r of t.userStorageAccess) {
      const existing = await prisma.userStorageAccess.findUnique({ where: { id: r.id } });
      if (existing) { if (options.overwriteExisting) update++; else skip++; }
      else create++;
    }
    summary["存储访问"] = { create, update, skip };
    totalRecords += create + update;
  }

  // ── CommandTemplates ──
  {
    let create = 0, update = 0, skip = 0;
    for (const r of t.commandTemplates) {
      const existing = await prisma.commandTemplate.findUnique({ where: { id: r.id } });
      if (existing) { if (options.overwriteExisting) update++; else skip++; }
      else create++;
    }
    summary["命令模板"] = { create, update, skip };
    totalRecords += create + update;
  }

  // ── QuickServices ──
  {
    let create = 0, update = 0, skip = 0;
    for (const r of t.quickServices) {
      const existing = await prisma.quickService.findUnique({ where: { id: r.id } });
      if (existing) { if (options.overwriteExisting) update++; else skip++; }
      else create++;
    }
    summary["快捷服务"] = { create, update, skip };
    totalRecords += create + update;
  }

  // ── Playbooks ──
  {
    let create = 0, update = 0, skip = 0;
    for (const r of t.playbooks) {
      const existing = await prisma.playbook.findUnique({ where: { id: r.id } });
      if (existing) { if (options.overwriteExisting) update++; else skip++; }
      else create++;
    }
    summary["Playbook"] = { create, update, skip };
    totalRecords += create + update;
  }

  // ── AlertRules ──
  {
    let create = 0, update = 0, skip = 0;
    for (const r of t.alertRules) {
      const existing = await prisma.alertRule.findUnique({ where: { id: r.id } });
      if (existing) { if (options.overwriteExisting) update++; else skip++; }
      else create++;
    }
    summary["告警规则"] = { create, update, skip };
    totalRecords += create + update;
  }

  // ── Settings ──
  {
    let create = 0, update = 0, skip = 0;
    if (options.importSettings) {
      for (const r of t.settings) {
        const existing = await prisma.setting.findUnique({ where: { key: r.key } });
        if (existing) { if (options.overwriteExisting) update++; else skip++; }
        else create++;
      }
    } else {
      skip = t.settings.length;
      warnings.push("已跳过系统设置导入（按选项设置）");
    }
    summary["系统设置"] = { create, update, skip };
    totalRecords += create + update;
  }

  // ── AiProviders ──
  {
    let create = 0, update = 0, skip = 0;
    for (const r of t.aiProviders) {
      const existing = await prisma.aiProvider.findUnique({ where: { id: r.id } });
      if (existing) { if (options.overwriteExisting) update++; else skip++; }
      else create++;
    }
    summary["AI 提供者"] = { create, update, skip };
    totalRecords += create + update;
  }

  // ── Announcements ──
  {
    let create = 0, update = 0, skip = 0;
    for (const r of t.announcements) {
      const existing = await prisma.announcement.findUnique({ where: { id: r.id } });
      if (existing) { if (options.overwriteExisting) update++; else skip++; }
      else create++;
    }
    summary["公告"] = { create, update, skip };
    totalRecords += create + update;
  }

  // ── Snippets ──
  {
    let create = 0, update = 0, skip = 0;
    for (const r of t.snippets) {
      const existing = await prisma.snippet.findUnique({ where: { id: r.id } });
      if (existing) { if (options.overwriteExisting) update++; else skip++; }
      else create++;
    }
    summary["代码片段"] = { create, update, skip };
    totalRecords += create + update;
  }

  // 安全警告 — only show for standard mode (full mode includes secrets)
  const isFullMode = file.exportMode === "full";
  if (!isFullMode) {
    if (t.users.length > 0) {
      warnings.push("用户密码哈希已剥离，导入后需重新设置密码");
    }
    if (t.sshKeys.length > 0) {
      warnings.push("SSH 私钥已剥离，导入后需重新上传或粘贴私钥");
    }
    if (t.servers.length > 0) {
      warnings.push("服务器密码已剥离，导入后需重新填写（或使用 SSH 密钥）");
    }
    if (t.aiProviders.length > 0) {
      warnings.push("AI 提供者 API Key 已剥离，导入后需重新填写");
    }
    if (t.settings.some((s) => s.value === "")) {
      warnings.push("部分敏感系统设置值已清空，导入后需重新配置");
    }
  } else {
    warnings.push("⚠ 此文件为完整导出模式，包含密码、密钥等敏感信息，请妥善保管");
  }

  return { summary, warnings, totalRecords };
}

// ── 真实导入 ──────────────────────────────────────────────

type ImportResult = {
  created: number;
  updated: number;
  skipped: number;
  errors: string[];
};

/**
 * 按依赖顺序事务性导入所有配置表。
 * 整个导入在一个 Prisma 事务中完成，任一步骤失败则全部回滚。
 */
export async function executeImport(
  file: ExportFile,
  options: ImportOptions,
): Promise<ImportResult> {
  const t = file.tables;
  let created = 0;
  let updated = 0;
  let skipped = 0;
  const errors: string[] = [];

  await prisma.$transaction(async (tx) => {
    // 1. Permissions
    for (const r of t.permissions) {
      const existing = await tx.permission.findUnique({ where: { id: r.id } });
      if (existing) {
        if (options.overwriteExisting) {
          await tx.permission.update({ where: { id: r.id }, data: { key: r.key, name: r.name, description: r.description } });
          updated++;
        } else { skipped++; }
      } else {
        await tx.permission.create({ data: { id: r.id, key: r.key, name: r.name, description: r.description } });
        created++;
      }
    }

    // 2. Roles
    for (const r of t.roles) {
      const existing = await tx.role.findUnique({ where: { id: r.id } });
      if (existing) {
        if (options.overwriteExisting) {
          await tx.role.update({ where: { id: r.id }, data: { key: r.key, name: r.name, description: r.description } });
          updated++;
        } else { skipped++; }
      } else {
        await tx.role.create({ data: { id: r.id, key: r.key, name: r.name, description: r.description } });
        created++;
      }
    }

    // 3. RolePermissions
    for (const r of t.rolePermissions) {
      const existing = await tx.rolePermission.findUnique({
        where: { roleId_permissionId: { roleId: r.roleId, permissionId: r.permissionId } },
      });
      if (!existing) {
        await tx.rolePermission.create({ data: { roleId: r.roleId, permissionId: r.permissionId } });
        created++;
      } else { skipped++; }
    }

    // 4. Users (可选)
    if (options.importUsers) {
      for (const r of t.users) {
        const existing = await tx.user.findUnique({ where: { id: r.id } });
        if (existing) {
          if (options.overwriteExisting) {
            await tx.user.update({
              where: { id: r.id },
              data: {
                username: r.username,
                displayName: r.displayName,
                // In full mode, restore password hash; otherwise keep existing
                ...(r.passwordHash ? { passwordHash: r.passwordHash } : {}),
                status: r.status as never,
                mustChangePassword: r.mustChangePassword,
                twoFactorEnabled: r.twoFactorEnabled,
                // In full mode, restore 2FA secret; otherwise keep existing
                ...(r.twoFactorSecret !== null ? { twoFactorSecret: r.twoFactorSecret } : {}),
              },
            });
            updated++;
          } else { skipped++; }
        } else {
          await tx.user.create({
            data: {
              id: r.id,
              username: r.username,
              displayName: r.displayName,
              // Full mode: restore actual hash; Standard: force password reset
              passwordHash: r.passwordHash ?? "DISABLED_IMPORT_RESET",
              status: r.status as never,
              mustChangePassword: r.passwordHash ? r.mustChangePassword : true,
              twoFactorEnabled: r.twoFactorEnabled,
              twoFactorSecret: r.twoFactorSecret,
              preferences: r.preferences as Prisma.InputJsonValue | undefined,
            },
          });
          created++;
        }
      }
    } else {
      skipped += t.users.length;
    }

    // 5. UserRoles
    for (const r of t.userRoles) {
      const existing = await tx.userRole.findUnique({
        where: { userId_roleId: { userId: r.userId, roleId: r.roleId } },
      });
      if (!existing) {
        try {
          await tx.userRole.create({
            data: {
              userId: r.userId,
             roleId: r.roleId,
              assignedAt: parseDate(r.assignedAt),
            },
          });
          created++;
        } catch {
          // FK 不存在 → skip
          skipped++;
        }
      } else { skipped++; }
    }

    // 6. SshKeys
    for (const r of t.sshKeys) {
      const existing = await tx.sshKey.findUnique({ where: { id: r.id } });
      if (existing) {
        if (options.overwriteExisting) {
          await tx.sshKey.update({
            where: { id: r.id },
            data: {
              name: r.name,
              fingerprint: r.fingerprint,
              publicKey: r.publicKey,
              // Full mode: restore private key + passphrase; Standard: keep existing
              ...(r.privateKey ? { privateKey: r.privateKey } : {}),
              ...(r.passphrase !== null && r.passphrase !== undefined ? { passphrase: r.passphrase } : {}),
              description: r.description,
            },
          });
          updated++;
        } else { skipped++; }
      } else {
        await tx.sshKey.create({
          data: {
            id: r.id,
            name: r.name,
            fingerprint: r.fingerprint,
            publicKey: r.publicKey,
            privateKey: r.privateKey,
            passphrase: r.passphrase,
            description: r.description,
          },
        });
        created++;
      }
    }

    // 7. Servers
    for (const r of t.servers) {
      const existing = await tx.server.findUnique({ where: { id: r.id } });
      if (existing) {
        if (options.overwriteExisting) {
          await tx.server.update({
            where: { id: r.id },
            data: {
              name: r.name,
              host: r.host,
              port: r.port,
              username: r.username,
              // Full mode: restore password; Standard: keep existing
              ...(r.password ? { password: r.password } : {}),
              sshKeyId: r.sshKeyId,
              description: r.description,
              tags: r.tags,
              enabled: r.enabled,
              connectionType: r.connectionType as never,
              publicUrl: r.publicUrl,
              fileProxyPort: r.fileProxyPort,
              osDialect: r.osDialect,
              osInfo: r.osInfo,
            },
          });
          updated++;
        } else { skipped++; }
      } else {
        await tx.server.create({
          data: {
            id: r.id,
            name: r.name,
            host: r.host,
            port: r.port,
            username: r.username,
            sshKeyId: r.sshKeyId,
            // Full mode: restore actual password; Standard: null
            password: r.password,
            description: r.description,
            tags: r.tags,
            enabled: r.enabled,
            connectionType: r.connectionType as never,
            publicUrl: r.publicUrl,
            fileProxyPort: r.fileProxyPort,
            osDialect: r.osDialect,
            osInfo: r.osInfo,
          },
        });
        created++;
      }
    }

    // 8. StorageNodes
    for (const r of t.storageNodes) {
      const existing = await tx.storageNode.findUnique({ where: { id: r.id } });
      if (existing) {
        if (options.overwriteExisting) {
          await tx.storageNode.update({
            where: { id: r.id },
            data: {
              name: r.name,
              driver: r.driver as never,
              isDefault: r.isDefault,
              basePath: r.basePath,
              directAccessMode: r.directAccessMode as never,
              publicBaseUrl: r.publicBaseUrl,
              directAccessExpiresSeconds: r.directAccessExpiresSeconds,
              host: r.host,
              port: r.port,
              username: r.username,
              serverId: r.serverId,
              healthStatus: r.healthStatus,
            },
          });
          updated++;
        } else { skipped++; }
      } else {
        await tx.storageNode.create({
          data: {
            id: r.id,
            name: r.name,
            driver: r.driver as never,
            isDefault: r.isDefault,
            basePath: r.basePath,
            directAccessMode: r.directAccessMode as never,
            publicBaseUrl: r.publicBaseUrl,
            directAccessExpiresSeconds: r.directAccessExpiresSeconds,
            host: r.host,
            port: r.port,
            username: r.username,
            serverId: r.serverId,
            healthStatus: r.healthStatus,
          },
        });
        created++;
      }
    }

    // 9. UserStorageAccess
    for (const r of t.userStorageAccess) {
      const existing = await tx.userStorageAccess.findUnique({ where: { id: r.id } });
      if (existing) {
        if (options.overwriteExisting) {
          await tx.userStorageAccess.update({
            where: { id: r.id },
            data: {
              userId: r.userId,
              storageNodeId: r.storageNodeId,
              pathPrefix: r.pathPrefix,
              canRead: r.canRead,
              canWrite: r.canWrite,
              canDelete: r.canDelete,
              quotaBytes: parseBigInt(r.quotaBytes),
              maxFileBytes: parseBigInt(r.maxFileBytes),
            },
          });
          updated++;
        } else { skipped++; }
      } else {
        try {
          await tx.userStorageAccess.create({
            data: {
              id: r.id,
              userId: r.userId,
              storageNodeId: r.storageNodeId,
              pathPrefix: r.pathPrefix,
              canRead: r.canRead,
              canWrite: r.canWrite,
              canDelete: r.canDelete,
              quotaBytes: parseBigInt(r.quotaBytes),
              maxFileBytes: parseBigInt(r.maxFileBytes),
            },
          });
          created++;
        } catch {
          skipped++;
        }
      }
    }

    // 10. CommandTemplates
    for (const r of t.commandTemplates) {
      const existing = await tx.commandTemplate.findUnique({ where: { id: r.id } });
      if (existing) {
        if (options.overwriteExisting) {
          await tx.commandTemplate.update({
            where: { id: r.id },
            data: {
              name: r.name,
              description: r.description,
              command: r.command,
              rollbackCommand: r.rollbackCommand,
              variables: r.variables,
              tags: r.tags,
              isBuiltin: r.isBuiltin,
              createdById: r.createdById,
            },
          });
          updated++;
        } else { skipped++; }
      } else {
        await tx.commandTemplate.create({
          data: {
            id: r.id,
            name: r.name,
            description: r.description,
            command: r.command,
            rollbackCommand: r.rollbackCommand,
            variables: r.variables,
            tags: r.tags,
            isBuiltin: r.isBuiltin,
            createdById: r.createdById,
          },
        });
        created++;
      }
    }

    // 11. QuickServices
    for (const r of t.quickServices) {
      const existing = await tx.quickService.findUnique({ where: { id: r.id } });
      if (existing) {
        if (options.overwriteExisting) {
          await tx.quickService.update({
            where: { id: r.id },
            data: {
              slug: r.slug,
              name: r.name,
              category: r.category,
              icon: r.icon,
              description: r.description,
              image: r.image,
              port: r.port,
              path: r.path,
              internalPort: r.internalPort,
              extraPortsJson: r.extraPortsJson,
              command: r.command,
              envJson: r.envJson,
              volumesJson: r.volumesJson,
            },
          });
          updated++;
        } else { skipped++; }
      } else {
        await tx.quickService.create({
          data: {
            id: r.id,
            slug: r.slug,
            name: r.name,
            category: r.category,
            icon: r.icon,
            description: r.description,
            image: r.image,
            port: r.port,
            path: r.path,
            internalPort: r.internalPort,
            extraPortsJson: r.extraPortsJson,
            command: r.command,
            envJson: r.envJson,
            volumesJson: r.volumesJson,
          },
        });
        created++;
      }
    }

    // 12. Playbooks
    for (const r of t.playbooks) {
      const existing = await tx.playbook.findUnique({ where: { id: r.id } });
      if (existing) {
        if (options.overwriteExisting) {
          await tx.playbook.update({
            where: { id: r.id },
            data: {
              name: r.name,
              description: r.description,
              triggerType: r.triggerType,
              triggerConfig: r.triggerConfig as Prisma.InputJsonValue,
              steps: r.steps as Prisma.InputJsonValue,
              chainRetry: r.chainRetry,
              enabled: r.enabled,
              createdById: r.createdById,
            },
          });
          updated++;
        } else { skipped++; }
      } else {
        await tx.playbook.create({
          data: {
            id: r.id,
            name: r.name,
            description: r.description,
            triggerType: r.triggerType,
            triggerConfig: r.triggerConfig as Prisma.InputJsonValue,
            steps: r.steps as Prisma.InputJsonValue,
            chainRetry: r.chainRetry,
            enabled: r.enabled,
            createdById: r.createdById,
          },
        });
        created++;
      }
    }

    // 13. AlertRules
    for (const r of t.alertRules) {
      const existing = await tx.alertRule.findUnique({ where: { id: r.id } });
      if (existing) {
        if (options.overwriteExisting) {
          await tx.alertRule.update({
            where: { id: r.id },
            data: {
              name: r.name,
              metric: r.metric,
              operator: r.operator,
              threshold: r.threshold,
              durationSeconds: r.durationSeconds,
              serverIds: r.serverIds,
              notifyChannels: r.notifyChannels,
              webhookUrl: r.webhookUrl,
              cooldownMinutes: r.cooldownMinutes,
              silenceWindows: r.silenceWindows,
              enabled: r.enabled,
            },
          });
          updated++;
        } else { skipped++; }
      } else {
        await tx.alertRule.create({
          data: {
            id: r.id,
            name: r.name,
            metric: r.metric,
            operator: r.operator,
            threshold: r.threshold,
            durationSeconds: r.durationSeconds,
            serverIds: r.serverIds,
            notifyChannels: r.notifyChannels,
            webhookUrl: r.webhookUrl,
            cooldownMinutes: r.cooldownMinutes,
            silenceWindows: r.silenceWindows,
            enabled: r.enabled,
          },
        });
        created++;
      }
    }

    // 14. Settings (可选)
    if (options.importSettings) {
      for (const r of t.settings) {
        const existing = await tx.setting.findUnique({ where: { key: r.key } });
        if (existing) {
          if (options.overwriteExisting) {
            // 敏感 key（空值）不覆盖
            if (r.value !== "") {
              await tx.setting.update({ where: { key: r.key }, data: { value: r.value } });
              updated++;
            } else { skipped++; }
          } else { skipped++; }
        } else {
          await tx.setting.create({ data: { key: r.key, value: r.value } });
          created++;
        }
      }
    } else {
      skipped += t.settings.length;
    }

    // 15. AiProviders
    for (const r of t.aiProviders) {
      const existing = await tx.aiProvider.findUnique({ where: { id: r.id } });
      if (existing) {
        if (options.overwriteExisting) {
          await tx.aiProvider.update({
            where: { id: r.id },
            data: {
              name: r.name,
              type: r.type as never,
              // Full mode: restore apiKey; Standard: keep existing
              ...(r.apiKey ? { apiKey: r.apiKey } : {}),
              baseUrl: r.baseUrl,
              defaultModel: r.defaultModel,
              availableModels: r.availableModels,
              isDefault: r.isDefault,
              enabled: r.enabled,
              settings: r.settings as Prisma.InputJsonValue,
            },
          });
          updated++;
        } else { skipped++; }
      } else {
        try {
          await tx.aiProvider.create({
            data: {
              id: r.id,
              name: r.name,
              type: r.type as never,
              apiKey: r.apiKey ?? "",
              baseUrl: r.baseUrl,
              defaultModel: r.defaultModel,
              availableModels: r.availableModels,
              isDefault: r.isDefault,
              enabled: r.enabled,
              settings: r.settings as Prisma.InputJsonValue,
              createdBy: r.createdBy,
            },
          });
          created++;
        } catch {
          skipped++;
        }
      }
    }

    // 16. Announcements
    for (const r of t.announcements) {
      const existing = await tx.announcement.findUnique({ where: { id: r.id } });
      if (existing) {
        if (options.overwriteExisting) {
          await tx.announcement.update({
            where: { id: r.id },
            data: {
              title: r.title,
              body: r.body,
              level: r.level,
              pinned: r.pinned,
              published: r.published,
              startsAt: r.startsAt ? parseDate(r.startsAt) : undefined,
              expiresAt: r.expiresAt ? parseDate(r.expiresAt) : null,
              createdBy: r.createdBy,
            },
          });
          updated++;
        } else { skipped++; }
      } else {
        await tx.announcement.create({
          data: {
            id: r.id,
            title: r.title,
            body: r.body,
            level: r.level,
            pinned: r.pinned,
            published: r.published,
            startsAt: r.startsAt ? parseDate(r.startsAt) : new Date(),
            expiresAt: r.expiresAt ? parseDate(r.expiresAt) : null,
            createdBy: r.createdBy,
          },
        });
        created++;
      }
    }

    // 17. Snippets
    for (const r of t.snippets) {
      const existing = await tx.snippet.findUnique({ where: { id: r.id } });
      if (existing) {
        if (options.overwriteExisting) {
          await tx.snippet.update({
            where: { id: r.id },
            data: {
              title: r.title,
              description: r.description,
              language: r.language,
              content: r.content,
              tags: r.tags,
              isPrivate: r.isPrivate,
              createdBy: r.createdBy,
            },
          });
          updated++;
        } else { skipped++; }
      } else {
        await tx.snippet.create({
          data: {
            id: r.id,
            title: r.title,
            description: r.description,
            language: r.language,
            content: r.content,
            tags: r.tags,
            isPrivate: r.isPrivate,
            createdBy: r.createdBy,
          },
        });
        created++;
      }
    }
  }).catch((err: unknown) => {
    // 事务失败 → 记录错误，不部分提交
    const msg = err instanceof Error ? err.message : String(err);
    errors.push(`事务失败: ${msg}`);
    throw err;
  });

  return { created, updated, skipped, errors };
}