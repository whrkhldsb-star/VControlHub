import { type TFn, type Locale } from "./core";
import { getServerLocale } from "./server-locale-cookie";
import { t as translate } from "./service-translations";

export async function serviceT(requestLocale?: Locale): Promise<TFn> {
	const locale = requestLocale ?? await getServerLocale();
	return (key: string, vars?: Record<string, string | number>) => translate(key, locale, vars);
}
