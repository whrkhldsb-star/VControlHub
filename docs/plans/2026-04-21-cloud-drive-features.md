# 云盘文件管理功能全面改进实施计划

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** 将 /files 页面从基础浏览提升为完整云盘体验，具备删除/重命名/移动/搜索/回收站/批量操作等标准云盘功能。

**Architecture:** Server Actions + Prisma + Server Components 为主，Client Components 处理交互状态（确认对话框、多选、搜索框）。所有变更走 `storage:write` / `storage:delete` 权限。LOCAL 节点同时操作真实文件系统和 DB；SFTP 节点仅操作 DB 条目。

**Tech Stack:** Next.js 15 App Router, React 19 useActionState, Prisma 7, Vitest, Tailwind CSS

---

## Phase 1: 文件/目录删除与回收站

### Task 1: 添加 deleteFileEntryAction 和 restoreFileEntryAction

**Objective:** 在 actions.ts 中添加删除和恢复 server actions

**Files:**
- Modify: `src/app/storage/actions.ts`

**Step 1: 添加 deleteFileEntryAction**

```typescript
export async function deleteFileEntryAction(_prev: StorageActionState | null, formData: FormData) {
  await requirePermission("storage:delete");

  try {
    const fileEntryId = String(formData.get("fileEntryId") ?? "").trim();
    if (!fileEntryId) {
      return { error: "缺少文件条目参数" } satisfies StorageActionState;
    }

    // 获取条目和存储节点信息
    const entry = await prisma.fileEntry.findUnique({
      where: { id: fileEntryId },
      include: { storageNode: { select: { id: true, driver: true, basePath: true } } },
    });

    if (!entry || entry.isDeleted) {
      return { error: "文件条目不存在或已删除" } satisfies StorageActionState;
    }

    // LOCAL 节点：删除真实文件
    if (entry.storageNode.driver === "LOCAL" && entry.entryType === "FILE") {
      const nodePath = await import("node:path");
      const { unlink, rmdir } = await import("node:fs/promises");
      const absolutePath = nodePath.resolve(entry.storageNode.basePath, entry.relativePath.replace(/^\/+/, ""));
      const allowedRoot = nodePath.resolve(entry.storageNode.basePath);
      const relativeToRoot = nodePath.relative(allowedRoot, absolutePath);

      if (!relativeToRoot.startsWith("..") && !nodePath.isAbsolute(relativeToRoot)) {
        try {
          if (entry.entryType === "DIRECTORY") {
            await rmdir(absolutePath, { recursive: false }).catch(() => {}); // 目录非空则跳过
          } else {
            await unlink(absolutePath).catch(() => {}); // 文件不存在也继续
          }
        } catch {
          // 真实文件删除失败不阻断DB软删除
        }
      }
    }

    // 目录类型：递归软删除子条目
    if (entry.entryType === "DIRECTORY") {
      const pathPrefix = entry.relativePath + "/";
      await prisma.fileEntry.updateMany({
        where: {
          storageNodeId: entry.storageNodeId,
          relativePath: { startsWith: pathPrefix },
          isDeleted: false,
        },
        data: { isDeleted: true },
      });
    }

    await prisma.fileEntry.update({
      where: { id: fileEntryId },
      data: { isDeleted: true },
    });

    revalidatePath("/");
    revalidatePath("/storage");
    revalidatePath("/files");

    return { success: `已删除 ${entry.name}` } satisfies StorageActionState;
  } catch (error) {
    return { error: error instanceof Error ? error.message : "删除失败" } satisfies StorageActionState;
  }
}
```

**Step 2: 添加 restoreFileEntryAction**

```typescript
export async function restoreFileEntryAction(_prev: StorageActionState | null, formData: FormData) {
  await requirePermission("storage:delete");

  try {
    const fileEntryId = String(formData.get("fileEntryId") ?? "").trim();
    if (!fileEntryId) {
      return { error: "缺少文件条目参数" } satisfies StorageActionState;
    }

    const entry = await prisma.fileEntry.findUnique({
      where: { id: fileEntryId },
      include: { storageNode: { select: { id: true, driver: true, basePath: true } } },
    });

    if (!entry || !entry.isDeleted) {
      return { error: "文件条目不存在或未删除" } satisfies StorageActionState;
    }

    // 目录类型：递归恢复子条目
    if (entry.entryType === "DIRECTORY") {
      const pathPrefix = entry.relativePath + "/";
      await prisma.fileEntry.updateMany({
        where: {
          storageNodeId: entry.storageNodeId,
          relativePath: { startsWith: pathPrefix },
          isDeleted: true,
        },
        data: { isDeleted: false },
      });
    }

    await prisma.fileEntry.update({
      where: { id: fileEntryId },
      data: { isDeleted: false },
    });

    revalidatePath("/");
    revalidatePath("/storage");
    revalidatePath("/files");

    return { success: `已恢复 ${entry.name}` } satisfies StorageActionState;
  } catch (error) {
    return { error: error instanceof Error ? error.message : "恢复失败" } satisfies StorageActionState;
  }
}
```

### Task 2: 添加 permanentDeleteFileEntryAction

**Objective:** 永久删除（从 DB 中真正移除条目）

**Files:**
- Modify: `src/app/storage/actions.ts`

添加 `permanentDeleteFileEntryAction`，权限 `storage:delete`，调用 `prisma.fileEntry.delete`。

### Task 3: 创建 DeleteConfirmButton 客户端组件

**Objective:** 点击删除后弹出确认，确认后执行

**Files:**
- Create: `src/app/files/delete-confirm-button.tsx`

客户端组件，使用 `useState` 管理确认状态，点击后先显示"确认删除？"和确认/取消按钮，确认后提交表单调用 `deleteFileEntryAction`。

### Task 4: 在文件列表中添加删除按钮

**Objective:** 每个文件和文件夹行增加删除操作

**Files:**
- Modify: `src/app/files/page.tsx`

在文件行和目录行的操作列添加 DeleteConfirmButton。需要传入 `canDelete` 权限判断。

### Task 5: 添加回收站视图

**Objective:** 在 /files 页面显示已删除文件，支持恢复和永久删除

**Files:**
- Modify: `src/app/files/page.tsx`

在页面底部或通过 tab/折叠面板展示 `storage.deletedEntries`，每行显示名称、路径、来源节点，提供恢复和永久删除按钮。

---

## Phase 2: 重命名

### Task 6: 添加 renameFileEntryAction

**Objective:** 在 actions.ts 中添加重命名 server action

**Files:**
- Modify: `src/app/storage/actions.ts`

重命名需要：更新 name、更新 relativePath（含新名称）、如果有子条目也要更新子条目的 relativePath 前缀。LOCAL 节点还需 rename 真实文件。

### Task 7: 创建 RenameInlineForm 客户端组件

**Objective:** 行内重命名，点击后变成输入框

**Files:**
- Create: `src/app/files/rename-inline-form.tsx`

点击重命名按钮后，当前名称变成输入框 + 确认/取消按钮，使用 `useActionState`。

### Task 8: 在文件列表中添加重命名按钮

**Files:**
- Modify: `src/app/files/page.tsx`

---

## Phase 3: 搜索

### Task 9: 添加文件搜索功能

**Objective:** 在 /files 页面添加搜索框，支持按名称模糊搜索

**Files:**
- Modify: `src/app/files/page.tsx`

添加搜索框（`?q=keyword`），在 `getStorageOverview` 返回结果中客户端过滤，或在 service 层添加 `searchFileEntries` 方法。为简洁起见，先用客户端过滤实现。

---

## Phase 4: 目录操作增强

### Task 10: 添加 renameFolderAction

**Objective:** 目录重命名（含子条目路径更新）

**Files:**
- Modify: `src/app/storage/actions.ts`

目录重命名需要：
1. 更新目录自身的 name 和 relativePath
2. 更新所有子条目的 relativePath（前缀替换）
3. LOCAL 节点：rename 真实目录

### Task 11: "上传文件" 按钮连接到拖拽区域

**Objective:** 当前"上传文件"按钮是空的，需要连接到 dropzone

**Files:**
- Modify: `src/app/files/page.tsx`

将上传文件按钮改为锚点滚动到页面下方的 FileUploadDropzone 区域，或使用 ref + scrollIntoView。

---

## Phase 5: UX 优化

### Task 12: 文件大小显示优化

**Objective:** sizeLabel 目前显示原始字节数，需要格式化为人类可读格式

**Files:**
- Modify: `src/lib/storage/service.ts`

将 `sizeLabel` 逻辑改为智能格式化：<1KB 显示 B，<1MB 显示 KB，<1GB 显示 MB 等。

### Task 13: 图片文件页内预览

**Objective:** MediaPreviewCard 目前仅支持视频预览，需增加图片预览

**Files:**
- Modify: `src/app/files/page.tsx`

在 MediaPreviewCard 中，对 image/* 类型使用 `<img>` 标签展示。

### Task 14: 修改时间显示

**Objective:** 文件列表增加修改时间列

**Files:**
- Modify: `src/app/files/page.tsx`

在表格头和行中添加 `updatedAt` 列，格式化为可读日期。

### Task 15: 目录项计数显示优化

**Objective:** 目录行的"大小"列显示子项目数而非 "-"

**Files:**
- Modify: `src/app/files/page.tsx`

---

## Phase 6: 测试更新

### Task 16: 更新 page.test.tsx 覆盖新功能

**Objective:** 更新测试以覆盖删除/恢复/重命名/搜索

**Files:**
- Modify: `src/app/files/__tests__/page.test.tsx`

### Task 17: 全量测试 + 构建 + 重启

**Run:**
```bash
cd /root/whrkhldsb && npm test
npm run build
systemctl restart whrkhldsb-next
```
