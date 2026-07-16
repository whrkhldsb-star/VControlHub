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

export function buildPropFindMultistatus(items: PropFindItem[]): string {
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
      return `  <D:response>
    <D:href>${escapeXml(item.href)}</D:href>
    <D:propstat>
      <D:prop>
        ${props.join("\n        ")}
      </D:prop>
      <D:status>HTTP/1.1 200 OK</D:status>
    </D:propstat>
  </D:response>`;
    })
    .join("\n");

  return `<?xml version="1.0" encoding="utf-8"?>
<D:multistatus xmlns:D="DAV:">
${bodies}
</D:multistatus>
`;
}

export function parseDepth(header: string | null): 0 | 1 | "infinity" {
  const value = (header ?? "1").trim().toLowerCase();
  if (value === "0") return 0;
  if (value === "infinity") return "infinity";
  return 1;
}
