import { type TFn } from "./core";
import { getServerLocale } from "./server-locale-cookie";
import { t as translate } from "./service-translations";

export async function serviceT(): Promise<TFn> {
	const locale = await getServerLocale();
	return (key: string, vars?: Record<string, string | number>) => translate(key, locale, vars);
}
