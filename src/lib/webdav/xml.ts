import { XMLParser, XMLValidator } from "fast-xml-parser";
import { ValidationError } from "@/lib/errors";
import { apiCopy } from "@/lib/i18n/api-copy";

/**
 * Minimal WebDAV multistatus XML helpers (RFC 4918).
 */
function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export type PropFindItem = {
  href: string;
  displayName: string;
  isCollection: boolean;
  contentLength?: number | null;
  contentType?: string | null;
  lastModified?: Date | null;
  etag?: string | null;
};

function formatHttpDate(date: Date): string {
  return date.toUTCString();
}

export function buildPropFindMultistatus(items: PropFindItem[], selection: Selection = "allprop"): string {
  const bodies = items
    .map((item) => {
      const props: string[] = [
        `<D:displayname>${escapeXml(item.displayName)}</D:displayname>`,
        item.isCollection
          ? `<D:resourcetype><D:collection/></D:resourcetype>`
          : `<D:resourcetype/>`,
      ];
      if (!item.isCollection && item.contentLength != null) {
        props.push(`<D:getcontentlength>${item.contentLength}</D:getcontentlength>`);
      }
      if (item.contentType) {
        props.push(`<D:getcontenttype>${escapeXml(item.contentType)}</D:getcontenttype>`);
      }
      if (item.lastModified) {
        props.push(
          `<D:getlastmodified>${escapeXml(formatHttpDate(item.lastModified))}</D:getlastmodified>`,
        );
      }
      if (item.etag) {
        props.push(`<D:getetag>${escapeXml(item.etag)}</D:getetag>`);
      }
      props.push(`<D:supportedlock/>`);
      const available = new Map(props.map(xml => [xml.match(/^<D:(\w+)/)![1]!, xml]));
      const names = Array.isArray(selection) ? selection : [...available.keys()].map(local => ({ local, ns: "DAV:" }));
      const ok: string[] = [], missing: string[] = [];
      for (const name of names) {
        const value = name.ns === "DAV:" && available.get(name.local);
        if (value) ok.push(selection === "propname" ? emptyProperty(name) : value);
        else missing.push(emptyProperty(name));
      }
      return `  <D:response>
    <D:href>${escapeXml(item.href)}</D:href>
    ${ok.length || !missing.length ? propstat(ok, "200 OK") : ""}${missing.length ? propstat(missing, "404 Not Found") : ""}
  </D:response>`;
    })
    .join("\n");

  return `<?xml version="1.0" encoding="utf-8"?>
<D:multistatus xmlns:D="DAV:">
${bodies}
</D:multistatus>
`;
}

export function parseDepth(header: string | null): 0 | 1 | "infinity" | null {
  const value = (header ?? "1").trim().toLowerCase();
  if (value === "0") return 0;
  if (value === "infinity") return "infinity";
  return value === "1" ? 1 : null;
}
type Name = { ns: string; local: string };
type Selection = "allprop" | "propname" | Name[];
type Element = Name & { children: Element[] };

export function parseDavProperties(text: string, method: "PROPFIND" | "PROPPATCH"): Selection {
  const invalid = (): never => { throw new ValidationError(apiCopy("apiCopy.webdav.invalidPropertyDocument")); };
  if (!text.trim() && method === "PROPFIND") return "allprop";
  if (/<!DOCTYPE|<!ENTITY/i.test(text) || XMLValidator.validate(text) !== true) return invalid();
  let raw: Record<string, unknown>[];
  try { raw = new XMLParser({ preserveOrder: true, ignoreAttributes: false, processEntities: true, maxNestedTags: 32 }).parse(text); }
  catch { return invalid(); }
  function elements(nodes: Record<string, unknown>[], inherited: Map<string, string>, depth: number): Element[] {
    if (depth > 32) return invalid();
    return nodes.flatMap(node => {
      const tag = Object.keys(node)[0]!;
      if (tag === "#text" || tag.startsWith("?")) return [];
      const namespaces = new Map(inherited);
      for (const [attr, uri] of Object.entries(node[":@"] ?? {})) {
        if (attr === "@_xmlns" || attr.startsWith("@_xmlns:")) namespaces.set(attr.slice(8), String(uri));
      }
      const parts = tag.split(":");
      const local = parts.pop()!;
      if (parts.length > 1 || !/^[\p{L}_][\p{L}\p{N}_.\-\u00b7\p{M}]*$/u.test(local)) return invalid();
      const ns = namespaces.get(parts[0] ?? "");
      if (parts.length && !ns) return invalid();
      return [{ ns: ns ?? "", local, children: elements(node[tag] as Record<string, unknown>[], namespaces, depth + 1) }];
    });
  }
  const roots = elements(raw, new Map(), 0), root = roots[0];
  if (roots.length !== 1 || root?.ns !== "DAV:" || root.local !== (method === "PROPFIND" ? "propfind" : "propertyupdate")) return invalid();
  if (method === "PROPFIND") {
    const mode = root.children[0];
    if (root.children.length !== 1 || mode?.ns !== "DAV:") return invalid();
    if ((mode.local === "allprop" || mode.local === "propname") && !mode.children.length) return mode.local;
    if (mode.local !== "prop") return invalid();
    return mode.children;
  }
  if (!root.children.length) return invalid();
  return root.children.flatMap(op => {
    const prop = op.children[0];
    if (op.ns !== "DAV:" || !["set", "remove"].includes(op.local) || op.children.length !== 1 || prop?.ns !== "DAV:" || prop.local !== "prop" || !prop.children.length) return invalid();
    return prop.children;
  });
}

function emptyProperty(name: Name) {
  return name.ns === "DAV:" ? `<D:${name.local}/>` : `<${name.local} xmlns="${escapeXml(name.ns)}"/>`;
}

function propstat(props: string[], status: string) {
  return `<D:propstat><D:prop>${props.join("")}</D:prop><D:status>HTTP/1.1 ${status}</D:status></D:propstat>`;
}

export function buildPatchResponse(href: string, names: Name[]) {
  return `<?xml version="1.0" encoding="utf-8"?><D:multistatus xmlns:D="DAV:"><D:response><D:href>${escapeXml(href)}</D:href>${propstat(names.map(emptyProperty), "403 Forbidden")}</D:response></D:multistatus>`;
}
