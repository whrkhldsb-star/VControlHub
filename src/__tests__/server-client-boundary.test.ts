// @vitest-environment node
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

import ts from "typescript";
import { describe, expect, it } from "vitest";

/**
 * A module that starts with "use client" hands the server references, not values: a server component may render
 * what it exports, but calling one of its functions throws when the page is requested ("Attempted to call … from
 * the server but … is on the client"). Neither the type checker nor the build reports it, and a unit test that
 * imports the function directly passes — the media detail page went out that way and failed for every item.
 *
 * This walks the imports from every server entry (pages, layouts, routes, Server Actions, the process entry
 * points) down to the first "use client" module on each path, and reports what is taken across that line and
 * used as anything but a component.
 */
const SRC = path.resolve(__dirname, "..");

type Import = { spec: string; line: number; names: string[] };
type Module = { directive: string; imports: Import[]; source: ts.SourceFile };

const modules = new Map<string, Module>();

function read(file: string): Module {
	const known = modules.get(file);
	if (known) return known;
	const source = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true, file.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
	const first = source.statements[0];
	const directive = first && ts.isExpressionStatement(first) && ts.isStringLiteral(first.expression) ? first.expression.text : "";
	const imports: Import[] = [];
	for (const statement of source.statements) {
		if (ts.isImportDeclaration(statement) && ts.isStringLiteral(statement.moduleSpecifier)) {
			const clause = statement.importClause;
			if (clause?.isTypeOnly) continue;
			const names: string[] = [];
			if (clause?.name) names.push(clause.name.text);
			const bindings = clause?.namedBindings;
			if (bindings && ts.isNamespaceImport(bindings)) names.push(bindings.name.text);
			if (bindings && ts.isNamedImports(bindings)) for (const element of bindings.elements) if (!element.isTypeOnly) names.push(element.name.text);
			imports.push({ spec: statement.moduleSpecifier.text, line: source.getLineAndCharacterOfPosition(statement.getStart()).line + 1, names });
		} else if (ts.isExportDeclaration(statement) && !statement.isTypeOnly && statement.moduleSpecifier && ts.isStringLiteral(statement.moduleSpecifier)) {
			imports.push({ spec: statement.moduleSpecifier.text, line: 0, names: [] });
		}
	}
	const entry = { directive, imports, source };
	modules.set(file, entry);
	return entry;
}

function resolve(from: string, spec: string): string | null {
	const base = spec.startsWith("@/") ? path.join(SRC, spec.slice(2)) : spec.startsWith(".") ? path.resolve(path.dirname(from), spec) : null;
	if (!base) return null;
	for (const candidate of [base, `${base}.ts`, `${base}.tsx`, path.join(base, "index.ts"), path.join(base, "index.tsx")]) {
		if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
	}
	return null;
}

/** How the importing module uses a name, leaving out the two uses a client reference allows: rendering it and naming its type. */
function otherUses(file: string, name: string): string[] {
	const uses = new Set<string>();
	const visit = (node: ts.Node) => {
		if (ts.isIdentifier(node) && node.text === name) {
			const parent = node.parent;
			if (ts.isImportSpecifier(parent) || ts.isImportClause(parent) || ts.isNamespaceImport(parent)) return;
			if ((ts.isJsxOpeningElement(parent) || ts.isJsxSelfClosingElement(parent) || ts.isJsxClosingElement(parent)) && parent.tagName === node) return;
			if (ts.isTypeReferenceNode(parent) || ts.isTypeQueryNode(parent) || ts.isExpressionWithTypeArguments(parent)) return;
			uses.add(ts.isCallExpression(parent) && parent.expression === node ? "called" : "used as a value");
		}
		ts.forEachChild(node, visit);
	};
	visit(read(file).source);
	return [...uses];
}

function sourceFiles(dir: string, found: string[] = []): string[] {
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const full = path.join(dir, entry.name);
		if (entry.isDirectory()) {
			if (entry.name !== "__tests__" && entry.name !== "node_modules") sourceFiles(full, found);
		} else if (/\.tsx?$/.test(entry.name) && !/\.(test|spec)\.tsx?$/.test(entry.name) && !entry.name.endsWith(".d.ts")) found.push(full);
	}
	return found;
}

const ENTRY = /[\\/](?:page|layout|route|template|default|not-found|loading|actions|manifest|sitemap|robots)\.tsx?$/;
const PROCESS_ENTRY = /[\\/]src[\\/](?:proxy|server|instrumentation|ssh-ws-proxy|worker)[^\\/]*\.ts$/;

describe("the line between server and client modules", () => {
	it("is crossed by server code only to render a component", () => {
		const all = sourceFiles(SRC);
		const queue = all.filter((file) => (ENTRY.test(file) || PROCESS_ENTRY.test(file) || read(file).directive === "use server") && read(file).directive !== "use client");
		// Enough entries to mean the walk found the application, not an empty directory.
		expect(queue.length).toBeGreaterThan(200);

		const server = new Set<string>();
		const crossings: string[] = [];
		while (queue.length) {
			const file = queue.pop()!;
			if (server.has(file)) continue;
			server.add(file);
			for (const imported of read(file).imports) {
				const target = resolve(file, imported.spec);
				if (!target) continue;
				if (read(target).directive !== "use client") {
					queue.push(target);
					continue;
				}
				for (const name of imported.names) {
					const uses = otherUses(file, name);
					if (uses.length) crossings.push(`${path.relative(SRC, file)}:${imported.line} ${name} is ${uses.join(" and ")}, but ${path.relative(SRC, target)} is a client module`);
				}
			}
		}
		expect(crossings.sort()).toEqual([]);
	}, 60_000);
});
