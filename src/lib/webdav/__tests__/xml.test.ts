/** @vitest-environment node */
import { describe, expect, it } from "vitest";

import { buildPropFindMultistatus, parseDepth } from "../xml";

describe("parseDepth", () => {
  it("defaults a missing header to 1, the value most clients rely on", () => {
    expect(parseDepth(null)).toBe(1);
    expect(parseDepth("")).toBe(1);
  });

  it("recognises the three legal values, case- and whitespace-insensitively", () => {
    expect(parseDepth("0")).toBe(0);
    expect(parseDepth("1")).toBe(1);
    expect(parseDepth("infinity")).toBe("infinity");
    expect(parseDepth(" Infinity ")).toBe("infinity");
  });

  it("does not silently widen an unparsable depth to infinity", () => {
    // Widening would turn a typo into a full-tree walk.
    expect(parseDepth("2")).not.toBe("infinity");
    expect(parseDepth("banana")).not.toBe("infinity");
  });
});

describe("buildPropFindMultistatus", () => {
  it("marks collections with <D:collection/> and omits a content length", () => {
    const xml = buildPropFindMultistatus([
      { href: "/api/webdav/n1/", displayName: "root", isCollection: true },
    ]);

    expect(xml).toContain("<D:multistatus");
    expect(xml).toContain("<D:collection/>");
    expect(xml).toContain("<D:href>/api/webdav/n1/</D:href>");
    expect(xml).toContain("HTTP/1.1 200 OK");
    expect(xml).not.toContain("<D:getcontentlength>");
  });

  it("emits size, type and etag for a file", () => {
    const xml = buildPropFindMultistatus([
      {
        href: "/api/webdav/n1/a.txt",
        displayName: "a.txt",
        isCollection: false,
        contentLength: 12,
        contentType: "text/plain",
        etag: 'W/"abc"',
        lastModified: new Date("2026-05-04T03:02:01Z"),
      },
    ]);

    expect(xml).toContain("<D:getcontentlength>12</D:getcontentlength>");
    expect(xml).toContain("<D:getcontenttype>text/plain</D:getcontenttype>");
    expect(xml).toContain("Mon, 04 May 2026 03:02:01 GMT");
  });

  it("escapes XML metacharacters in names so one file cannot corrupt the response", () => {
    const xml = buildPropFindMultistatus([
      { href: "/api/webdav/n1/a%26b.txt", displayName: 'a&b<"\'>.txt', isCollection: false },
    ]);

    expect(xml).not.toContain('a&b<"\'>.txt');
    expect(xml).toContain("&amp;");
    expect(xml).toContain("&lt;");
  });

  it("produces a well-formed empty multistatus for no items", () => {
    const xml = buildPropFindMultistatus([]);

    expect(xml).toContain("<D:multistatus");
    expect(xml).toContain("</D:multistatus>");
    expect(xml).not.toContain("<D:response>");
  });
});
