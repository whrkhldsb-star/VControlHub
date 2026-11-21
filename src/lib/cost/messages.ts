import type { Locale } from "@/lib/i18n/core";

const en = {
	accountChanged: "Billing account changed during the update. Reload and retry.",
	reviewCsv: "Cannot reconcile previous CSV line numbers. Review the complete original bill before retrying.",
	interrupted: "Import interrupted before completion",
	sourceDate: "The billing source sets this date. Record a linked adjustment instead.",
	addAdjustment: "Add adjustment",
};
const zh: Record<keyof typeof en, string> = {
	accountChanged: "账单账户已被更新，请重新加载并重试。",
	reviewCsv: "无法核对旧 CSV 账单行号，请检查完整的原始账单后重试。",
	interrupted: "账单导入在完成前中断",
	sourceDate: "此日期由计费来源管理。如需调整，请另记关联条目。",
	addAdjustment: "记调整条目",
};

export function costMessage(key: keyof typeof en, locale: Locale = "zh"): string {
	return (locale === "en" ? en : zh)[key];
}
