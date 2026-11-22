import type { Locale } from "@/lib/i18n/core";

const en = {
	accountChanged: "Billing account changed during the update. Reload and retry.",
	reviewCsv: "Cannot match the CSV charges to the ledger. Review the complete original bill before retrying.",
	fractionalCsv: "Import the complete bill for this month and currency to recalculate fractional-cent charges.",
	interrupted: "Import interrupted before completion",
	sourceDate: "The billing source sets this date. Record a linked adjustment instead.",
	addAdjustment: "Add adjustment",
	linkedAdjustments: "This entry has linked adjustments. Remove them before deleting the source.",
};
const zh: Record<keyof typeof en, string> = {
	accountChanged: "账单账户已被更新，请重新加载并重试。",
	reviewCsv: "无法将 CSV 费用与已入账条目逐一核对，请检查完整的原始账单后重试。",
	fractionalCsv: "请导入该月该币种的完整账单，以重新分摊不足一分的费用。",
	interrupted: "账单导入在完成前中断",
	sourceDate: "此日期由计费来源管理。如需调整，请另记关联条目。",
	addAdjustment: "记调整条目",
	linkedAdjustments: "此账目有关联的调整条目，请先删除调整条目。",
};

export function costMessage(key: keyof typeof en, locale: Locale = "zh"): string {
	return (locale === "en" ? en : zh)[key];
}
