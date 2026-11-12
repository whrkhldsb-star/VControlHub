// @vitest-environment node
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import ts from "typescript";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import { withApiCopyLocale } from "@/lib/i18n/api-copy";
import { firstSchemaSentence, isSchemaSentence, localizeSchemaMessage, SCHEMA_COPY_ZH } from "@/lib/i18n/schema-copy";

/**
 * The sentences schema authors wrote for their checks are English literals; the validation library's own
 * messages follow the request's language (zod-locale.ts), these did not. A refused password reset on a Chinese
 * page read "newPassword: New password must be at least 8 characters".
 *
 * They stay where they are, as the English sentence; the catalog gives the Chinese one, and this test reads
 * every schema so that a new sentence cannot be added without its translation.
 */
const SRC = path.resolve(__dirname, "../../..");

/** Methods of a zod chain and the position of their message argument (-1: only an options object). */
const MESSAGE_ARGUMENT: Record<string, number> = {
	min: 1, max: 1, length: 1, regex: 1, gt: 1, gte: 1, lt: 1, lte: 1, multipleOf: 1, startsWith: 1, endsWith: 1, includes: 1,
	email: 0, url: 0, uuid: 0, int: 0, positive: 0, negative: 0, nonnegative: 0, nonpositive: 0, nonempty: 0, finite: 0, safe: 0,
	datetime: 0, date: 0, time: 0, ip: 0, cuid: 0, trim: -1, refine: 1, superRefine: -1,
	string: 0, number: 0, boolean: 0, bigint: 0, array: 1, object: 1, enum: 1, nativeEnum: 1, literal: 1, union: 1, discriminatedUnion: 2, record: 2, tuple: 1,
};

function schemaSentences(): Map<string, string> {
	const found = new Map<string, string>();
	const walk = (dir: string) => {
		for (const entry of readdirSync(dir, { withFileTypes: true })) {
			const full = path.join(dir, entry.name);
			if (entry.isDirectory()) {
				if (entry.name !== "__tests__" && entry.name !== "node_modules") walk(full);
				continue;
			}
			if (!/\.tsx?$/.test(entry.name) || /\.(test|spec)\.tsx?$/.test(entry.name)) continue;
			const text = readFileSync(full, "utf8");
			if (!/from\s+["']zod["']/.test(text)) continue;
			const source = ts.createSourceFile(full, text, ts.ScriptTarget.Latest, true, full.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
			const literal = (node: ts.Node | undefined): node is ts.StringLiteral | ts.NoSubstitutionTemplateLiteral =>
				Boolean(node) && (ts.isStringLiteral(node!) || ts.isNoSubstitutionTemplateLiteral(node!));
			const add = (node: ts.StringLiteral | ts.NoSubstitutionTemplateLiteral) => {
				if (!found.has(node.text)) found.set(node.text, `${path.relative(SRC, full)}:${source.getLineAndCharacterOfPosition(node.getStart()).line + 1}`);
			};
			const fromOptions = (node: ts.Node | undefined) => {
				if (!node || !ts.isObjectLiteralExpression(node)) return;
				for (const property of node.properties) {
					if (!ts.isPropertyAssignment(property)) continue;
					const name = property.name.getText(source).replace(/["']/g, "");
					if ((name === "message" || name === "error") && literal(property.initializer)) add(property.initializer);
				}
			};
			const visit = (node: ts.Node) => {
				if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
					const method = node.expression.name.text;
					const index = MESSAGE_ARGUMENT[method];
					const receiver = node.expression.expression.getText(source).replace(/\s+/g, "");
					if (index !== undefined && (/(^|[^A-Za-z0-9_$.])z\./.test(receiver) || receiver === "z" || /[Ss]chema\b/.test(receiver))) {
						const argument = index >= 0 ? node.arguments[index] : undefined;
						if (literal(argument)) add(argument);
						for (const each of node.arguments) fromOptions(each);
					}
					if (method === "addIssue") for (const each of node.arguments) fromOptions(each);
				}
				ts.forEachChild(node, visit);
			};
			visit(source);
		}
	};
	walk(SRC);
	return found;
}

describe("the sentences schemas refuse with", () => {
	const sentences = schemaSentences();

	it("are found by the scan (it reads the application, not an empty directory)", () => {
		expect(sentences.size).toBeGreaterThan(150);
		expect(sentences.has("New password must be at least 8 characters")).toBe(true);
	});

	it("all have a Chinese sentence", () => {
		const untranslated = [...sentences].filter(([sentence]) => !isSchemaSentence(sentence)).map(([sentence, where]) => `${where} ${JSON.stringify(sentence)}`);
		expect(untranslated).toEqual([]);
	});

	it("and the catalog holds nothing that no schema says any more", () => {
		expect(Object.keys(SCHEMA_COPY_ZH).filter((sentence) => !sentences.has(sentence))).toEqual([]);
	});

	it("are written as sentences, not as a garbled translation", () => {
		// "Unsupported'sstorage nodetype" was what the storage node route refused an unknown driver with.
		const garbled = [...sentences.keys()].filter((sentence) => /[a-z]'s[a-z]|\s{2,}|^\s|\s$/.test(sentence));
		expect(garbled).toEqual([]);
		for (const chinese of Object.values(SCHEMA_COPY_ZH)) {
			expect(chinese.trim()).toBe(chinese);
			expect(chinese).toMatch(/[一-鿿]/);
		}
	});
});

describe("localizeSchemaMessage", () => {
	it("gives the Chinese sentence on a Chinese page and leaves the English one alone", () => {
		expect(localizeSchemaMessage("New password must be at least 8 characters", "zh")).toBe("新密码至少 8 位");
		expect(localizeSchemaMessage("New password must be at least 8 characters", "en")).toBe("New password must be at least 8 characters");
	});

	it("passes through what is not a schema sentence", () => {
		// The validation library's own message, already in the request's language; and names every object has.
		expect(localizeSchemaMessage("数值过小：期望 string >=1 字符", "zh")).toBe("数值过小：期望 string >=1 字符");
		expect(localizeSchemaMessage("constructor", "zh")).toBe("constructor");
		expect(isSchemaSentence("toString")).toBe(false);
	});

	it("reads the first refusal of a failed parse in the language of the request", () => {
		const parsed = z.object({ newPassword: z.string().min(8, "New password must be at least 8 characters") }).safeParse({ newPassword: "ab" });
		expect(parsed.success).toBe(false);
		if (parsed.success) return;
		expect(withApiCopyLocale("zh", () => firstSchemaSentence(parsed.error))).toBe("新密码至少 8 位");
		expect(withApiCopyLocale("en", () => firstSchemaSentence(parsed.error))).toBe("New password must be at least 8 characters");
		expect(firstSchemaSentence(new z.ZodError([]))).toBeUndefined();
	});
});
