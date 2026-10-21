/**
 * i18n dictionary: `recycleBinSection.*` (11 keys).
 *
 * The Recycle Bin section lives inside the file manager (`/files`). Kept as
 * its own dictionary so a future round that i18n-ises `file-list-client`
 * can fold it into a `filesPage.*` namespace without breaking the existing
 * `recycleBinSection.*` call sites.
 */
export const zh: Record<string, string> = {
	"recycleBinSection.title": "回收站",
	"recycleBinSection.empty": "回收站为空，没有已删除的文件。",
	"recycleBinSection.summary": "共 {count} 个已删除条目。恢复后文件将回到原路径。",
	"recycleBinSection.table.name": "名称",
	"recycleBinSection.table.size": "大小",
	"recycleBinSection.table.actions": "操作",
	"recycleBinSection.entryType.directory": "目录",
	"recycleBinSection.entryType.file": "文件",
	"recycleBinSection.noPermission": "无权限",
	"recycleBinSection.table.deletedAt": "删除时间",
	"recycleBinSection.bulk.region": "回收站批量操作",
	"recycleBinSection.bulk.selectAll": "全选回收站项目",
	"recycleBinSection.bulk.restore": "恢复所选",
	"recycleBinSection.bulk.delete": "永久删除所选",
	"recycleBinSection.bulk.progress": "处理中 {done}/{total}",
	"recycleBinSection.bulk.confirmDelete": "永久删除选中的 {count} 项？此操作不可恢复。",
	"recycleBinSection.bulk.restored": "已恢复 {count} 项",
	"recycleBinSection.bulk.deleted": "已永久删除 {count} 项",
	"recycleBinSection.bulk.failures": "{count} 项未处理成功",
};

export const en: Record<string, string> = {
	"recycleBinSection.title": "Recycle Bin",
	"recycleBinSection.empty": "The recycle bin is empty — no deleted files.",
	"recycleBinSection.summary": "{count} deleted entries. Restoring returns the file to its original path.",
	"recycleBinSection.table.name": "Name",
	"recycleBinSection.table.size": "Size",
	"recycleBinSection.table.actions": "Actions",
	"recycleBinSection.entryType.directory": "Directory",
	"recycleBinSection.entryType.file": "File",
	"recycleBinSection.noPermission": "No permission",
	"recycleBinSection.table.deletedAt": "Deleted",
	"recycleBinSection.bulk.region": "Recycle bin batch actions",
	"recycleBinSection.bulk.selectAll": "Select all recycle bin entries",
	"recycleBinSection.bulk.restore": "Restore selected",
	"recycleBinSection.bulk.delete": "Delete selected forever",
	"recycleBinSection.bulk.progress": "Working {done}/{total}",
	"recycleBinSection.bulk.confirmDelete": "Permanently delete the {count} selected items? This cannot be undone.",
	"recycleBinSection.bulk.restored": "Restored {count} items",
	"recycleBinSection.bulk.deleted": "Permanently deleted {count} items",
	"recycleBinSection.bulk.failures": "{count} items could not be processed",
};
