import ts from "typescript";

export type CopyFinding = { file: string; line: number; pattern: string; text: string; start: number; end: number };
const errorTypes = new Set(["AuthError", "ForbiddenError", "NotFoundError", "ValidationError", "ConflictError", "BusinessError", "AppError"]);
export function scanApiCopy(file: string, source: string): CopyFinding[] {
 const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
 const lines = source.split(/\r?\n/);
 const found = new Map<number, CopyFinding>();
 const add = (node: ts.Node | undefined, pattern: string) => {
  if (!node || !(ts.isStringLiteralLike(node) || ts.isTemplateExpression(node))) return;
  const text = ts.isStringLiteralLike(node) ? node.text : node.head.text + node.templateSpans.map((span) => "${" + span.expression.getText(tree) + "}" + span.literal.text).join("");
  if (!/[A-Za-z]{3,}/.test(text) || /^[A-Z0-9_:-]+$/.test(text) || /^[a-z0-9_.:-]+$/.test(text)) return;
  const start = node.getStart(tree), line = tree.getLineAndCharacterOfPosition(start).line;
  if (/api-copy-audit: allow\s+--\s+\S/.test(lines[line] ?? "")) return;
  found.set(start, { file, line: line + 1, pattern, text, start, end: node.end });
 };
 const objectCopy = (node: ts.Node | undefined, pattern: string) => {
  if (!node || !ts.isObjectLiteralExpression(node)) return;
  for (const prop of node.properties) if (ts.isPropertyAssignment(prop) && ["error", "message"].includes(prop.name.getText(tree).replace(/["']/g, ""))) add(prop.initializer, pattern);
 };
 const visit = (node: ts.Node) => {
  if (ts.isNewExpression(node) && errorTypes.has(node.expression.getText(tree))) add(node.arguments?.[0], "typed-error");
  if (ts.isCallExpression(node)) {
   const name = node.expression.getText(tree);
   if (name === "NextResponse.json" || name === "Response.json") objectCopy(node.arguments[0], "json-error");
   if (name === "apiError") {
    objectCopy(node.arguments[0], "api-error");
    add(node.arguments[1], "api-error");
   }
  }
  if (ts.isPropertyAssignment(node) && node.name.getText(tree).replace(/["']/g, "") === "errorMessage") add(node.initializer, "guard-error-message");
  ts.forEachChild(node, visit);
 };
 visit(tree);
 return [...found.values()].sort((a, b) => a.start - b.start);
}
