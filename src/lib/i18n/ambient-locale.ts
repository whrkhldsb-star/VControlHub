import type { Locale } from "./core";

/**
 * The language text is being written in right now, for code that runs on the server and in the browser alike
 * and has no translator at hand (turning a schema's refusal into a sentence, say).
 *
 * On the server the answer is in request-scoped storage (api-copy.ts), which a module that also ships to the
 * browser cannot import; that module registers its reader here when it loads, and it is loaded by everything
 * that sets a locale (API routes, Server Actions, the worker). In the browser it is the language of the page.
 */
let serverCopyLocale: (() => Locale | undefined) | undefined;

export function registerServerCopyLocale(read: () => Locale | undefined): void {
	serverCopyLocale = read;
}

/** What the language switch last applied, else what the root layout rendered; undefined without a document. */
export function documentLocale(): Locale | undefined {
	if (typeof document === "undefined") return undefined;
	const root = document.documentElement;
	const applied = root.dataset.locale;
	if (applied === "zh" || applied === "en") return applied;
	return root.lang.toLowerCase().startsWith("en") ? "en" : "zh";
}

/**
 * Where the server's reader is loaded the answer is its own, a missing one included: the same process words
 * `apiCopy()` by it, and one message must not come out in two languages. (Only a test has both a document and
 * the reader.)
 */
export function ambientCopyLocale(): Locale | undefined {
	return serverCopyLocale ? serverCopyLocale() : documentLocale();
}

/**
 * The catalog of schema sentences (schema-copy.ts) registers its lookup here, so that the error helper every
 * page imports does not carry two hundred sentences into the browser: on the server the catalog is always
 * loaded (api-copy.ts imports it), in the browser only by a page that validates with a schema itself.
 */
let schemaSentence: ((message: string, locale: Locale) => string) | undefined;

export function registerSchemaSentences(localize: (message: string, locale: Locale) => string): void {
	schemaSentence = localize;
}

/** A sentence a schema's author wrote, in `locale`; the message itself when it is not one or no catalog is loaded. */
export function ambientSchemaSentence(message: string, locale: Locale): string {
	return schemaSentence ? schemaSentence(message, locale) : message;
}
