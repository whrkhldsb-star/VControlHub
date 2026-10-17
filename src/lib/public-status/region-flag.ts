/**
 * Country codes for the status board: an optional ISO 3166-1 alpha-2 code per
 * public node, shown as its flag (regional-indicator emoji). Platforms
 * without flag glyphs (Windows) render the two letters instead, which still
 * reads as the country.
 */
const REGIONAL_INDICATOR_A = 0x1f1e6;

/** Normalize a code typed by an administrator; null when it is not two letters. */
export function normalizeCountryCode(value: string | null | undefined): string | null {
	const code = (value ?? "").trim().toUpperCase();
	return /^[A-Z]{2}$/.test(code) ? code : null;
}

/** "JP" → 🇯🇵; null for anything that is not a two-letter code. */
export function countryFlag(code: string | null | undefined): string | null {
	const normalized = normalizeCountryCode(code);
	if (!normalized) return null;
	return String.fromCodePoint(...[...normalized].map((letter) => REGIONAL_INDICATOR_A + letter.charCodeAt(0) - 65));
}

/**
 * Names of common hosting locations. A fixed table rather than
 * Intl.DisplayNames: the server's and the browser's ICU data name places
 * differently (中国香港特别行政区 / 香港), which broke hydration of every flag.
 */
const COUNTRY_NAMES: Record<string, { zh: string; en: string }> = {
	CN: { zh: "中国", en: "China" }, HK: { zh: "香港", en: "Hong Kong" }, TW: { zh: "台湾", en: "Taiwan" }, MO: { zh: "澳门", en: "Macao" },
	JP: { zh: "日本", en: "Japan" }, KR: { zh: "韩国", en: "South Korea" }, SG: { zh: "新加坡", en: "Singapore" }, MY: { zh: "马来西亚", en: "Malaysia" },
	TH: { zh: "泰国", en: "Thailand" }, VN: { zh: "越南", en: "Vietnam" }, ID: { zh: "印度尼西亚", en: "Indonesia" }, PH: { zh: "菲律宾", en: "Philippines" },
	IN: { zh: "印度", en: "India" }, AE: { zh: "阿联酋", en: "United Arab Emirates" }, TR: { zh: "土耳其", en: "Türkiye" }, IL: { zh: "以色列", en: "Israel" },
	US: { zh: "美国", en: "United States" }, CA: { zh: "加拿大", en: "Canada" }, MX: { zh: "墨西哥", en: "Mexico" }, BR: { zh: "巴西", en: "Brazil" },
	AR: { zh: "阿根廷", en: "Argentina" }, CL: { zh: "智利", en: "Chile" },
	GB: { zh: "英国", en: "United Kingdom" }, IE: { zh: "爱尔兰", en: "Ireland" }, DE: { zh: "德国", en: "Germany" }, FR: { zh: "法国", en: "France" },
	NL: { zh: "荷兰", en: "Netherlands" }, BE: { zh: "比利时", en: "Belgium" }, LU: { zh: "卢森堡", en: "Luxembourg" }, CH: { zh: "瑞士", en: "Switzerland" },
	AT: { zh: "奥地利", en: "Austria" }, IT: { zh: "意大利", en: "Italy" }, ES: { zh: "西班牙", en: "Spain" }, PT: { zh: "葡萄牙", en: "Portugal" },
	SE: { zh: "瑞典", en: "Sweden" }, NO: { zh: "挪威", en: "Norway" }, FI: { zh: "芬兰", en: "Finland" }, DK: { zh: "丹麦", en: "Denmark" },
	PL: { zh: "波兰", en: "Poland" }, CZ: { zh: "捷克", en: "Czechia" }, RO: { zh: "罗马尼亚", en: "Romania" }, UA: { zh: "乌克兰", en: "Ukraine" },
	RU: { zh: "俄罗斯", en: "Russia" }, AU: { zh: "澳大利亚", en: "Australia" }, NZ: { zh: "新西兰", en: "New Zealand" }, ZA: { zh: "南非", en: "South Africa" },
};

/** Country name ("JP" → 日本 / Japan); the code itself for a place not in the table. */
export function countryName(code: string, locale: "zh" | "en"): string {
	const normalized = normalizeCountryCode(code);
	if (!normalized) return code;
	return COUNTRY_NAMES[normalized]?.[locale] ?? normalized;
}

/** Common hosting locations, offered as suggestions in the publication form. */
export const COMMON_COUNTRY_CODES = Object.keys(COUNTRY_NAMES);
