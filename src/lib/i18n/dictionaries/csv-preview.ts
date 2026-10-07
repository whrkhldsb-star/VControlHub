/**
 * i18n dictionary: `csvPreview.*` (8 keys).
 */
export const zh: Record<string, string> = {
  "csvPreview.boundedWarning": "仅预览前 500 行及最多 2 MiB 内的完整记录，内容已截断。请下载原文件查看全部数据。",
  "csvPreview.tooManyColumns": "列数超过预览上限（200 列），请下载原文件查看。",
  "csvPreview.invalidQuotes": "表格引号格式不完整，请下载原文件核对。",
	"csvPreview.tableBadge": "表格预览",
	"csvPreview.loading": "正在加载…",
	"csvPreview.empty": "CSV 文件为空",
	"csvPreview.colIndex": "列{index}",
	"csvPreview.rowCol": "{rows} 行 × {cols} 列",
	"csvPreview.largeWarning": "数据量较大，仅显示前 {max} 行（共 {total} 行）。建议下载后使用专业工具查看。",
	"csvPreview.parseFailed": "CSV 解析失败",
	"csvPreview.loadFailed": "加载失败",
	"csvPreview.loadFailedWithStatus": "加载失败: {status}",
};

export const en: Record<string, string> = {
  "csvPreview.boundedWarning": "Partial preview: at most 500 data rows and complete records within 2 MiB. Download the original for all data.",
  "csvPreview.tooManyColumns": "The table exceeds the 200-column preview limit. Download the original file.",
  "csvPreview.invalidQuotes": "Invalid or incomplete quoted field. Download the original file to inspect it.",
	"csvPreview.tableBadge": "Table preview",
	"csvPreview.loading": "Loading…",
	"csvPreview.empty": "CSV file is empty",
	"csvPreview.colIndex": "Col {index}",
	"csvPreview.rowCol": "{rows} rows × {cols} cols",
	"csvPreview.largeWarning": "Large dataset — only the first {max} of {total} rows are shown. Download and use a spreadsheet tool to view the rest.",
	"csvPreview.parseFailed": "Failed to parse CSV",
	"csvPreview.loadFailed": "Failed to load",
	"csvPreview.loadFailedWithStatus": "Failed to load: {status}",
};
