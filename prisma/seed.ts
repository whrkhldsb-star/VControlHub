import { UserStatus } from "@prisma/client";

import { ADMIN_BOOTSTRAP, getInitialAdminPassword } from "@/lib/auth/bootstrap";
import { prisma } from "@/lib/db";
import {
  ALL_PERMISSIONS,
  DEFAULT_ROLE_PERMISSIONS,
  type RoleKey,
} from "../src/lib/auth/rbac";
import { hashPassword } from "../src/lib/auth/password";

const PERMISSION_LABELS: Record<string, { name: string; description: string }> = {
  "announcement:manage": { name: "管理公告", description: "允许发布、置顶和下线站内公告" },
 "api-token:manage": { name: "管理 API Token", description: "允许创建和撤销个人 API Token" },
 "ai:manage": { name: "管理 AI 助手", description: "允许配置 AI 提供商、创建对话与多模态交互" },
 "deploy:export":{ name: "导出部署包", description: "允许生成不含敏感值的部署迁移模板包" },
  "media:manage": { name: "管理媒体库", description: "允许扫描、标记和浏览图片视频媒体资源" },
  "snippet:manage": { name: "管理代码片段", description: "允许创建、搜索和维护在线代码片段" },
  "ticket:manage": { name: "管理工单", description: "允许创建、回复和流转站内请求工单" },
  "audit:read": { name: "查看审计日志", description: "允许查看操作与执行审计日志" },
  "backup:create": { name: "创建备份", description: "允许创建数据库或平台备份记录" },
  "backup:read": { name: "查看备份", description: "允许查看备份记录与迁移状态" },
  "backup:restore": { name: "恢复备份", description: "允许发起备份恢复操作" },
  "deploy:manage": { name: "管理部署", description: "允许管理应用部署模板与配置" },
  "deploy:read": { name: "查看部署", description: "允许查看部署模板与运行记录" },
  "deploy:run": { name: "执行部署", description: "允许基于模板发起应用部署任务" },
  "health:read": { name: "查看系统健康", description: "允许查看系统健康中心与一键体检结果" },
  "notification:manage": { name: "管理通知渠道", description: "允许配置告警与通知渠道" },
  "share:create": { name: "创建分享", description: "允许为云盘文件创建分享链接" },
  "share:manage": { name: "管理分享", description: "允许撤销和管理文件分享链接" },
  "share:read": { name: "查看分享", description: "允许查看文件分享记录" },
  "task:read": { name: "查看任务中心", description: "允许查看统一任务中心与操作队列" },
  "command:approve": { name: "审批命令", description: "允许审批待执行命令" },
  "command:create": { name: "创建命令", description: "允许创建命令执行请求" },
  "command:execute": { name: "执行命令", description: "允许发起和执行命令" },
  "command:read": { name: "查看命令", description: "允许查看命令执行记录" },
  "role:manage": { name: "管理角色", description: "允许创建和修改角色与权限" },
  "server:read": { name: "查看服务器", description: "允许查看 VPS 节点信息" },
  "server:ssh": { name: "使用 SSH 终端", description: "允许打开 VPS WebSocket SSH 终端" },
  "server:write": { name: "管理服务器", description: "允许新增、编辑、启停 VPS 节点配置" },
  "storage:delete": { name: "删除文件", description: "允许删除云盘文件与目录" },
  "storage:manage-node": { name: "管理存储节点", description: "允许配置本地或远端 SFTP 存储节点" },
  "storage:read": { name: "查看云盘", description: "允许浏览文件与媒体预览" },
  "storage:write": { name: "写入云盘", description: "允许上传、移动、重命名文件" },
  "user:manage": { name: "管理用户", description: "允许创建和禁用后台用户" },
  "user:read": { name: "查看用户", description: "允许查看用户与成员信息" },
};

const ROLE_LABELS: Record<RoleKey, { name: string; description: string }> = {
  admin: { name: "管理员", description: "平台最高权限，可管理所有资源与审批流" },
  operator: { name: "运维", description: "负责日常节点管理、命令下发与文件维护" },
  viewer: { name: "观察者", description: "只读访问审计、节点与云盘信息" },
  storage_manager: { name: "存储管理员", description: "负责云盘节点、文件与媒体资源管理" },
};

async function seedPermissions() {
  for (const permission of ALL_PERMISSIONS) {
    const label = PERMISSION_LABELS[permission];
    await prisma.permission.upsert({
      where: { key: permission },
      update: {
        name: label.name,
        description: label.description,
      },
      create: {
        key: permission,
        name: label.name,
        description: label.description,
      },
    });
  }
}

async function seedRoles() {
  for (const [roleKey, permissions] of Object.entries(DEFAULT_ROLE_PERMISSIONS) as [RoleKey, typeof ALL_PERMISSIONS][]) {
    const role = await prisma.role.upsert({
      where: { key: roleKey },
      update: {
        name: ROLE_LABELS[roleKey].name,
        description: ROLE_LABELS[roleKey].description,
      },
      create: {
        key: roleKey,
        name: ROLE_LABELS[roleKey].name,
        description: ROLE_LABELS[roleKey].description,
      },
    });

    await prisma.rolePermission.deleteMany({ where: { roleId: role.id } });

    for (const permission of permissions) {
      const permissionRecord = await prisma.permission.findUniqueOrThrow({
        where: { key: permission },
      });

      await prisma.rolePermission.create({
        data: {
          roleId: role.id,
          permissionId: permissionRecord.id,
        },
      });
    }
  }
}

async function seedAdmin() {
 const passwordHash = await hashPassword(getInitialAdminPassword());
 const existingAdmin = await prisma.user.findUnique({
 where: { username: ADMIN_BOOTSTRAP.username },
 });

 const admin = await prisma.user.upsert({
 where: { username: ADMIN_BOOTSTRAP.username },
 update: {
 displayName: ADMIN_BOOTSTRAP.displayName,
 // Do NOT overwrite passwordHash / status / mustChangePassword on re-seed
 // so that users who have already changed their password stay intact
 ...(!existingAdmin
 ? {
 passwordHash,
 status: UserStatus.PENDING_PASSWORD_RESET,
 mustChangePassword: true,
 }
 : {}),
 },
 create: {
 username: ADMIN_BOOTSTRAP.username,
 displayName: ADMIN_BOOTSTRAP.displayName,
 passwordHash,
 status: UserStatus.PENDING_PASSWORD_RESET,
 mustChangePassword: true,
 },
 });

  const adminRole = await prisma.role.findUniqueOrThrow({ where: { key: "admin" } });

  await prisma.userRole.upsert({
    where: {
      userId_roleId: {
        userId: admin.id,
        roleId: adminRole.id,
      },
    },
    update: {},
    create: {
      userId: admin.id,
      roleId: adminRole.id,
    },
  });
}

function shouldSeedDemoData() {
  return process.env.SEED_DEMO_DATA === "true" || process.env.DEMO_MODE === "true";
}

async function seedDemoData() {
  const admin = await prisma.user.findUniqueOrThrow({ where: { username: ADMIN_BOOTSTRAP.username } });

  const server = await prisma.server.upsert({
    where: { id: "srv_demo_local" },
    update: {
      name: "demo-local-vps",
      host: "127.0.0.1",
      port: 22,
      username: "root",
      description: "仅用于本地演示；生产 seed 默认不会创建。",
      tags: ["demo"],
      enabled: false,
      connectionType: "SSH_KEY",
    },
    create: {
      id: "srv_demo_local",
      name: "demo-local-vps",
      host: "127.0.0.1",
      port: 22,
      username: "root",
      description: "仅用于本地演示；生产 seed 默认不会创建。",
      tags: ["demo"],
      enabled: false,
      connectionType: "SSH_KEY",
    },
  });

  await prisma.storageNode.upsert({
    where: { id: "node_demo_local" },
    update: {
      name: "本地演示云盘",
      driver: "LOCAL",
      isDefault: false,
      basePath: "storage/demo",
      serverId: null,
    },
    create: {
      id: "node_demo_local",
      name: "本地演示云盘",
      driver: "LOCAL",
      isDefault: false,
      basePath: "storage/demo",
      serverId: null,
    },
  });

  await prisma.commandRequest.upsert({
    where: { id: "cmd_demo_check_disk" },
    update: {
      title: "Demo: check disk usage",
      command: "df -h",
      reason: "本地演示命令；生产 seed 默认不会创建。",
      initiatedByType: "USER",
      requesterId: admin.id,
    },
    create: {
      id: "cmd_demo_check_disk",
      title: "Demo: check disk usage",
      command: "df -h",
      reason: "本地演示命令；生产 seed 默认不会创建。",
      initiatedByType: "USER",
      requesterId: admin.id,
      targets: {
        create: {
          serverId: server.id,
          status: "PENDING_APPROVAL",
        },
      },
    },
  });
}

export async function seedDatabase() {
	if (process.env.NODE_ENV === "production") {
		const demoFlags = ["SEED_DEMO_DATA", "DEMO_MODE", "ENABLE_DEMO_FALLBACK", "AUTH_DEMO_FALLBACK", "SERVER_DEMO_FALLBACK", "STORAGE_DEMO_FALLBACK", "COMMAND_DEMO_FALLBACK"];
		for (const flag of demoFlags) {
			if (process.env[flag]?.trim().toLowerCase() === "true") {
				throw new Error(`${flag}=true is forbidden when NODE_ENV=production`);
			}
		}
	}
	await seedPermissions();
  await seedRoles();
  await seedAdmin();
  if (shouldSeedDemoData()) {
    await seedDemoData();
  }
}

if (process.env.NODE_ENV !== "test") {
  seedDatabase()
    .then(async () => {
      await prisma.$disconnect();
    })
    .catch(async (error) => {
      console.error(error);
      await prisma.$disconnect();
      process.exit(1);
    });
}
