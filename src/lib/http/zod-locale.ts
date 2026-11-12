/**
 * The validation library's own messages in the language of the request.
 *
 * A schema without custom text answers with zod's defaults ("Too small:
 * expected string to have >=1 characters"), English on every page. zod ships
 * its messages per locale and accepts one per parse, so nothing global is
 * switched: two requests in different languages can be validated at once.
 * A message a schema's author wrote stays as written.
 */
import zhCN from "zod/v4/locales/zh-CN.js";

import { currentCopyLocale } from "@/lib/i18n/api-copy";

const chinese = zhCN().localeError;

/** Second argument for `schema.safeParse()` / `schema.parse()` when validating what a request sent. */
export function requestParseParams(): { error: typeof chinese } | undefined {
	return currentCopyLocale() === "zh" ? { error: chinese } : undefined;
}
