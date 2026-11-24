import { davPermissions } from "@/lib/openapi/webdav";
/** Build-time only. Rebuild with npx tsx src/app/api/docs/openapi/build-method-catalog.ts */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import ts from "typescript";
import catalog from "../../../../../docs/route-catalog.json";

// Every group is required. Within a group any one permission suffices.
type Requirements = string[][];
type MethodCatalog = Record<string, Record<string, Requirements>>;

type Bindings = Map<string, ts.Expression>;

function resolveValue(expr: ts.Expression | undefined, bindings: Bindings): ts.Expression | undefined {
  if (!expr) return;
  if (ts.isAsExpression(expr) || ts.isSatisfiesExpression(expr) || ts.isParenthesizedExpression(expr)) {
    return resolveValue(expr.expression, bindings);
  }
  return ts.isIdentifier(expr) ? resolveValue(bindings.get(expr.text), bindings) : expr;
}

/** Conditional guards require one branch's permissions. If a branch is public, none are universal. */
function alternatives(left: string[], right: string[]): string[] {
  return left.length && right.length ? [...new Set([...left, ...right])] : [];
}

function guardOptions(expr: ts.Expression | undefined, bindings: Bindings): string[] {
  const obj = resolveValue(expr, bindings);
  if (!obj) return [];
  if (ts.isConditionalExpression(obj)) return alternatives(guardOptions(obj.whenTrue, bindings), guardOptions(obj.whenFalse, bindings));
  if (!ts.isObjectLiteralExpression(obj)) return [];
  for (const prop of obj.properties) {
    if (ts.isSpreadAssignment(prop)) {
      const group = guardOptions(prop.expression, bindings);
      if (group.length) return group;
    }
    if (!ts.isPropertyAssignment(prop)) continue;
    const value = resolveValue(prop.initializer, bindings);
    if (prop.name.getText() === "permission" && value && ts.isStringLiteral(value)) return [value.text];
    if (prop.name.getText() === "permissions" && value && ts.isArrayLiteralExpression(value)) {
      return value.elements.filter(ts.isStringLiteral).map((entry) => entry.text);
    }
  }
  return [];
}

function checkedPermissions(expr: ts.Expression, bindings: Bindings): string[] {
  const check = resolveValue(expr, bindings);
  if (!check) return [];
  if (ts.isConditionalExpression(check)) return alternatives(checkedPermissions(check.whenTrue, bindings), checkedPermissions(check.whenFalse, bindings));
  if (ts.isCallExpression(check) && check.expression.getText() === "sessionHasPermission") {
    const permission = resolveValue(check.arguments[1], bindings);
    if (permission && ts.isStringLiteral(permission)) return [permission.text];
  }
  return [];
}

function bind(decl: ts.VariableDeclaration, bindings: Bindings) {
  if (ts.isIdentifier(decl.name) && decl.initializer) bindings.set(decl.name.text, decl.initializer);
}

function collectMethod(file: string, method: string): Requirements {
  const src = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true);
  const globals: Bindings = new Map();
  const functions = new Map<string, ts.ConciseBody>();
  for (const stmt of src.statements) {
    if (ts.isExportDeclaration(stmt) && stmt.moduleSpecifier && ts.isStringLiteral(stmt.moduleSpecifier) && stmt.exportClause && ts.isNamedExports(stmt.exportClause)) {
      const entry = stmt.exportClause.elements.find((e) => e.name.text === method);
      if (entry) return collectMethod(resolve(dirname(file), stmt.moduleSpecifier.text + ".ts"), entry.propertyName?.text ?? method);
    }
    if (ts.isVariableStatement(stmt)) for (const decl of stmt.declarationList.declarations) bind(decl, globals);
    if (ts.isFunctionDeclaration(stmt) && stmt.name && stmt.body) functions.set(stmt.name.text, stmt.body);
  }
  const groups: Requirements = [];
  const visited = new Set<ts.ConciseBody>();
  function visitBody(body: ts.ConciseBody, bindings: Bindings) {
    if (visited.has(body)) return;
    visited.add(body);
    visit(body, new Map(bindings));
  }
  function visit(node: ts.Node, bindings: Bindings) {
    if (ts.isVariableDeclaration(node)) bind(node, bindings);
    // Only rejections at handler scope represent entry requirements. Checks
    // inside a conditional may gate optional actions or individual fields.
    if (ts.isIfStatement(node)) {
      const condition = node.expression;
      const first = ts.isBlock(node.thenStatement) ? node.thenStatement.statements[0] : node.thenStatement;
      if (first && (ts.isThrowStatement(first) || ts.isReturnStatement(first))
          && ts.isPrefixUnaryExpression(condition) && condition.operator === ts.SyntaxKind.ExclamationToken) {
        groups.push(checkedPermissions(condition.operand, bindings));
      }
      return;
    }
    if (ts.isIterationStatement(node, false) || ts.isSwitchStatement(node) || ts.isConditionalExpression(node) || ts.isFunctionLike(node)) return;
    if (ts.isCallExpression(node)) {
      const name = node.expression.getText();
      if (name === "enforceApiGuard") groups.push(guardOptions(node.arguments[0], bindings));
      if (name === "withApiRoute") groups.push(guardOptions(node.arguments[1], bindings));
      const handler = name === "withApiRoute" ? node.arguments[2] : name === "withApiCopyLocale" ? node.arguments[1] : undefined;
      if (handler && (ts.isArrowFunction(handler) || ts.isFunctionExpression(handler))) visitBody(handler.body, bindings);
      if (name === "withServerLifecycleLock" || name === "withServerLifecycleSharedLock") {
        const work = node.arguments[1];
        if (work && ts.isArrowFunction(work)) visitBody(work.body, bindings);
      }
      const delegated = functions.get(name);
      if (delegated) visitBody(delegated, globals);
    }
    ts.forEachChild(node, (child) => visit(child, bindings));
  }
  const body = functions.get(method);
  if (body) visitBody(body, globals);
  return groups.filter((group, index) => group.length && !groups.slice(0, index).some((other) => JSON.stringify(other) === JSON.stringify(group)));
}


export function buildMethodCatalog(): MethodCatalog {
  const result: MethodCatalog = {};
  for (const route of catalog.apiRoutes) {
    for (const method of route.methods) {
      const groups = route.path.startsWith("/api/webdav/") ? davPermissions[method] ?? [] : collectMethod(resolve(route.file), method);
      if (groups.length) (result[route.path] ??= {})[method] = groups;
    }
  }
  return result;
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const rows = Object.entries(buildMethodCatalog()).map(([path, methods]) => `  ${JSON.stringify(path)}: ${JSON.stringify(methods)}`);
  writeFileSync(resolve("src/app/api/docs/openapi/method-catalog.json"), "{\n" + rows.join(",\n") + "\n}\n");
}
