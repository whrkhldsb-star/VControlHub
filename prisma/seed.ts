import { UserStatus } from "@prisma/client";

import { ADMIN_BOOTSTRAP, getInitialAdminPassword } from "../src/lib/auth/bootstrap";
import { prisma } from "../src/lib/db";
import {
  ALL_PERMISSIONS,
  DEFAULT_ROLE_PERMISSIONS,
  type RoleKey,
} from "../src/lib/auth/rbac";
import { hashPassword } from "../src/lib/auth/password";

const PERMISSION_LABELS: Record<string, { name: string; description: string }> = {
  "audit:read": { name: "查看审计日志", description: "允许查看操作与执行审计日志" },
  "command:approve": { name: "审批命令", description: "允许审批待执行命令" },
  "command:create": { name: "创建命令", description: "允许创建命令执行请求" },
  "command:execute": { name: "执行命令", description: "允许发起和执行命令" },
  "command:read": { name: "查看命令", description: "允许查看命令执行记录" },
  "role:manage": { name: "管理角色", description: "允许创建和修改角色与权限" },
  "server:read": { name: "查看服务器", description: "允许查看 VPS 节点信息" },
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

async function main() {
  await seedPermissions();
  await seedRoles();
  await seedAdmin();
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
