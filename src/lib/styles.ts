/**
 * styles — 共享 className 常量。
 * 把出现 7+ 次的重复 className 字符串集中在此处，
 * 改样式只需改一处，不用全局 grep。
 */

/** 标准表单输入框（input/textarea/select）— 11 处 */
export const INPUT_CLS =
	"w-full rounded-lg border border-white/[0.06] bg-white/[0.04] px-3.5 py-2.5 text-sm text-white outline-none transition-colors placeholder:text-white/20 focus:border-[var(--color-action-border)]/30 focus:bg-white/[0.06] disabled:opacity-50 light:border-slate-200 light:bg-white light:text-slate-900 light:placeholder:text-slate-400 light:focus:border-[var(--color-action-border)]/50";

/** 错误状态输入框 — 9 处 */
export const INPUT_ERROR_CLS =
	"rounded-lg bg-rose-500/[0.08] border border-rose-400/20 px-3.5 py-2.5 text-sm text-rose-200 light:text-rose-600";

/** 表格 thead 单元格 — 14 处 */
export const TABLE_TH_CLS =
	"px-4 py-3 text-left text-xs font-medium text-[var(--text-muted)] uppercase tracking-wider";

/** 旧式深色输入框（bg-slate-950，部分表单使用）— 16 处 */
export const INPUT_DARK_CLS =
	"rounded-2xl border border-[var(--border)] bg-slate-950 px-4 py-3 text-white light:bg-white light:text-slate-900 light:border-slate-200";

/** 胶囊/标签按钮（filter chips 等）— 8 处 */
export const CHIP_CLS =
	"rounded-full border border-[var(--border)] bg-white/[0.03] px-3 py-1.5 transition-colors hover:bg-white/[0.06]";

/** 表单 label 行 grid（label + input 对）— 8 处 */
export const FORM_FIELD_CLS = "grid gap-1.5 text-xs font-medium text-[var(--text-secondary)]";
