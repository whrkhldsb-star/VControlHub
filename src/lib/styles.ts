/**
 * styles — 共享 className 常量。
 * 把出现 7+ 次的重复 className 字符串集中在此处，
 * 改样式只需改一处，不用全局 grep。
 *
 * 全部使用 CSS 变量 (var(--*)) 确保暗色/浅色模式一致。
 */

/** 标准表单输入框（input/textarea/select）— 11 处 */
export const INPUT_CLS =
	"w-full rounded-lg border border-[var(--input-border)] bg-[var(--input-bg)] px-3.5 py-2.5 text-sm text-[var(--text-primary)] outline-none transition-colors placeholder:text-[var(--text-muted)] focus:border-[var(--input-border-focus)] focus:ring-2 focus:ring-[var(--accent-bg)] disabled:opacity-50";

/** 错误状态输入框 — 9 处 */
export const INPUT_ERROR_CLS =
	"rounded-lg bg-[var(--danger-bg)] border border-[var(--danger-border)] px-3.5 py-2.5 text-sm text-[var(--danger)]";

/** 表格 thead 单元格 — 14 处 */
export const TABLE_TH_CLS =
	"px-4 py-3 text-left text-xs font-medium text-[var(--text-muted)] uppercase tracking-wider";

/** 旧式深色输入框（部分表单使用）— 16 处 */
export const INPUT_DARK_CLS =
	"rounded-lg border border-[var(--input-border)] bg-[var(--input-bg)] px-4 py-3 text-[var(--text-primary)] outline-none transition-colors placeholder:text-[var(--text-muted)] focus:border-[var(--input-border-focus)] focus:ring-2 focus:ring-[var(--accent-bg)]";

/** 胶囊/标签按钮（filter chips 等）— 8 处 */
export const CHIP_CLS =
	"rounded-lg border border-[var(--border)] bg-[var(--surface-elevated)] px-3 py-1.5 transition-colors hover:bg-[var(--surface-hover)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]";

/** 表单 label 行 grid（label + input 对）— 8 处 */
export const FORM_FIELD_CLS = "grid gap-1.5 text-xs font-medium text-[var(--text-secondary)]";
