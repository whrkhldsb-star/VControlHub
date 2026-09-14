import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { build } from "esbuild";
import postcss from "postcss";
import tailwind from "@tailwindcss/postcss";

const output = path.resolve(process.argv[2] ?? "/tmp/vcontrolhub-ui-showcase");
await mkdir(output, { recursive: true });
const cssPath = path.resolve("src/app/globals.css");
const css = await postcss([tailwind()]).process(await readFile(cssPath, "utf8"), { from: cssPath });
const bundle = await build({
  entryPoints: ["scripts/design-system/showcase.tsx"], bundle: true, write: false,
  platform: "browser", format: "iife", jsx: "automatic", minify: true,
  define: { "process.env.NODE_ENV": '"production"' },
});
// Next supplies these font variables in the application layout. The standalone
// reference uses local system fonts so it remains usable without network access.
const fonts = ":root{--font-geist-sans:system-ui,sans-serif;--font-geist-mono:ui-monospace,monospace}";
const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>VControlHub UI reference</title><style>${css.css.replaceAll("</style", "<\\/style")}${fonts}</style></head><body><div id="root"></div><script>${bundle.outputFiles[0].text.replaceAll("</script", "<\\/script")}</script></body></html>`;
await writeFile(path.join(output, "index.html"), html);
console.log(path.join(output, "index.html"));
