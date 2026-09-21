import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import type TypeScript from "typescript";
import { describe, expect, it } from "vitest";

const ts: typeof TypeScript = createRequire(import.meta.url)("typescript");

/** Public share uses its password-grant cookie, not authenticated-session CSRF.
 * Keep its native fetch (redirect: error) independent of the dashboard client.
 * All other browser requests must use api-client / csrfFetch, including raw bodies.
 */
const nativeFetchExceptions = new Set(["src/app/share/[token]/share-password-gate.tsx"]);
function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name === "api" || entry.name === "__tests__") return [];
    // Normalize to "/" so the exception list below is platform-independent.
    const file = path.join(dir, entry.name).split(path.sep).join("/");
    return entry.isDirectory() ? sources(file) : /\.tsx?$/.test(file) ? [file] : [];
  });
}
describe("browser fetch governance", () => {
  it("only permits documented public-share native fetch", () => {
    const violations: string[] = [];
    for (const file of [...sources("src/components"), ...sources("src/app")]) {
      if (nativeFetchExceptions.has(file)) continue;
      const ast = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true);
      const visit = (node: TypeScript.Node) => {
        if (ts.isCallExpression(node) && (
          (ts.isIdentifier(node.expression) && node.expression.text === "fetch") ||
          (ts.isPropertyAccessExpression(node.expression) && ["window", "globalThis"].includes(node.expression.expression.getText(ast)) && node.expression.name.text === "fetch")
        )) violations.push(`${file}:${ast.getLineAndCharacterOfPosition(node.getStart()).line + 1}`);
        ts.forEachChild(node, visit);
      };
      visit(ast);
    }
    expect(violations).toEqual([]);
  });
});
