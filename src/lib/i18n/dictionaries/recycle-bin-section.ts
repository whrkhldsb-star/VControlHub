/**
 * i18n dictionary: `recycleBinSection.*` (8 keys).
 *
 * The Recycle Bin section lives inside the file manager (`/files`). Kept as
 * its own dictionary so a future round that i18n-ises `file-list-client`
 * can fold it into a `filesPage.*` namespace without breaking the existing
 * `recycleBinSection.*` call sites.
 */
export const zh: Record<string, string> = {
	"recycleBinSection.title": "🗑️ 回收站",
	"recycleBinSection.empty": "回收站为空，没有已删除的文件。",
	"recycleBinSection.summary": "共 {count} 个已删除条目。恢复后文件将回到原路径。",
	"recycleBinSection.table.name": "名称",
	"recycleBinSection.table.type": "类型",
	"recycleBinSection.table.size": "大小",
	"recycleBinSection.table.path": "路径",
	"recycleBinSection.table.actions": "操作",
	"recycleBinSection.entryType.directory": "目录",
	"recycleBinSection.entryType.file": "文件",
	"recycleBinSection.noPermission": "无权限",
};

export const en: Record<string, string> = {
	"recycleBinSection.title": "🗑️ Recycle Bin",
	"recycleBinSection.empty": "The recycle bin is empty — no deleted files.",
	"recycleBinSection.summary": "{count} deleted entries. Restoring returns the file to its original path.",
	"recycleBinSection.table.name": "Name",
	"recycleBinSection.table.type": "Type",
	"recycleBinSection.table.size": "Size",
	"recycleBinSection.table.path": "Path",
	"recycleBinSection.table.actions": "Actions",
	"recycleBinSection.entryType.directory": "Directory",
	"recycleBinSection.entryType.file": "File",
	"recycleBinSection.noPermission": "No permission",
};
