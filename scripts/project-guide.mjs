import { readFileSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { dirname, resolve, relative } from "node:path";
import { fileURLToPath } from "node:url";
import MarkdownIt from "markdown-it";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const source = resolve(root, "docs/project-overview-and-user-guide.zh-CN.md");
const output = source.replace(/\.md$/, ".html");
const text = readFileSync(source, "utf8");
const md = new MarkdownIt({ html: true }); // trusted repository document only
const assets = JSON.parse(readFileSync(resolve(root, "scripts/project-guide/diagrams.json"), "utf8"));
const defaultFence = md.renderer.rules.fence;
md.renderer.rules.fence = (tokens, index, options, env, renderer) => {
  if (tokens[index].info.trim() !== "mermaid") return defaultFence(tokens, index, options, env, renderer);
  const diagram = assets[tokens[index].content.trim()];
  if (!diagram) throw new Error("Guide diagram changed: update the reviewed SVG and source in scripts/project-guide/diagrams.json");
  return diagram + "\n";
};
md.renderer.rules.table_open = () => '<div class="table-scroll" tabindex="0"><table>\n';
md.renderer.rules.table_close = () => '</table></div>\n';
const heading = md.renderer.rules.heading_open;
md.renderer.rules.heading_open = (tokens, index, options, env, renderer) => {
  const title = tokens[index + 1]?.content ?? "";
  const number = title.match(/^(\d+\.\d+)\s/);
  if (number) tokens[index].attrSet("id", `section-${number[1].replaceAll(".", "-")}`);
  return heading ? heading(tokens, index, options, env, renderer) : renderer.renderToken(tokens, index, options);
};
const tokens = md.parse(text, {});
const links = [];
function collect(items) {
  for (const token of items) {
    if (token.type === "link_open") links.push(decodeURIComponent(token.attrGet("href")));
    if (token.children) collect(token.children);
  }
}
collect(tokens);
for (const link of links) {
  if (/^(?:https?:|mailto:|#)/.test(link)) continue;
  const pathname = decodeURIComponent(link.split("#")[0]);
  if (!existsSync(resolve(dirname(source), pathname))) throw new Error(`Broken guide link: ${link}`);
}
function walk(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(dir, entry.name);
    return entry.isDirectory() ? walk(path) : [path];
  });
}
const files = walk(resolve(root, "src/app"));
for (const path of files.filter((p) => /[/\\](page\.tsx|route\.ts)$/.test(p))) {
  const link = "../" + relative(root, path).replaceAll("\\", "/");
  if (!links.includes(link)) throw new Error(`Guide entry missing: ${link}`);
}
const schema = readFileSync(resolve(root, "prisma/schema.prisma"), "utf8");
const models = [...schema.matchAll(/^model\s+(\w+)\s*\{/gm)].map((m) => m[1]);
for (const name of models) if (!text.includes(`\`${name}\``)) throw new Error(`Guide model missing: ${name}`);
const pages = files.filter((p) => /[/\\]page\.tsx$/.test(p)).length;
const routes = files.filter((p) => /[/\\]api[/\\].*[/\\]route\.ts$/.test(p)).length;
for (const phrase of [`${pages} 个 \`page.tsx\``, `${routes} 个 API 路由文件`, `${models.length} 个 Prisma 数据模型`]) {
  if (!text.includes(phrase)) throw new Error(`Guide counts stale: expected ${phrase}`);
}
// The reader already has a mobile and desktop TOC.
const body = text.replace(/## 目录\n[\s\S]*?(?=<a id="project")/, "");
const rendered = md.render(body).replace(/(?:<p>)?<a id="([^"]+)"><\/a>(?:<\/p>)?\s*<h2>/g, '<h2 id="$1">');
const html = readFileSync(resolve(root, "scripts/project-guide/template.html"), "utf8").replace("{{CONTENT}}", rendered);
const markup = html.replace(/<script>[\s\S]*?<\/script>/g, "");
const ids = [...markup.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]);
if (ids.length !== new Set(ids).size) throw new Error("Duplicate guide HTML anchors");
for (const [, anchor] of markup.matchAll(/href="#([^"]+)"/g)) {
  if (!ids.includes(anchor)) throw new Error(`Missing guide anchor: ${anchor}`);
}
if (process.argv.includes("--write")) { writeFileSync(output, html); console.log("Project guide HTML generated"); }
else if (readFileSync(output, "utf8") !== html) { throw new Error("Project guide HTML is stale. Run npm run guide:build"); }
else console.log(`Project guide verified: ${pages} pages, ${routes} routes, ${models.length} models; links, anchors and HTML match`);
