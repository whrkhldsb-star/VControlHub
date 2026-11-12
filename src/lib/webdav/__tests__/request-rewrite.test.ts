import { describe, expect, it } from "vitest";

import {
  isWebDavRequestTarget,
  stripWebDavTrailingSlash,
  WEBDAV_OVERRIDE_METHODS,
} from "../request-rewrite";

describe("WebDAV request rewrite (custom server)", () => {
  it("recognises the WebDAV route and nothing that merely starts like it", () => {
    expect(isWebDavRequestTarget("/api/webdav")).toBe(true);
    expect(isWebDavRequestTarget("/api/webdav/node1")).toBe(true);
    expect(isWebDavRequestTarget("/api/webdav/node1/a/b.txt?x=1")).toBe(true);
    expect(isWebDavRequestTarget("/api/webdavx/node1")).toBe(false);
    expect(isWebDavRequestTarget("/api/webdav-download?path=/api/webdav/")).toBe(false);
    expect(isWebDavRequestTarget("/files?next=/api/webdav/node1/")).toBe(false);
    expect(isWebDavRequestTarget(undefined)).toBe(false);
  });

  // Next answers a path that ends in "/" with a 308 before the route runs, and
  // WebDAV clients address every collection that way (MKCOL /dir/, PROPFIND
  // /dir/, the hrefs this server lists). litmus, cadaver and davfs2 stopped at
  // the first MKCOL.
  it.each([
    ["/api/webdav/node1/", "/api/webdav/node1"],
    ["/api/webdav/node1/photos/", "/api/webdav/node1/photos"],
    ["/api/webdav/node1/photos//", "/api/webdav/node1/photos"],
    ["/api/webdav/node1/%E4%B8%AD%E6%96%87/", "/api/webdav/node1/%E4%B8%AD%E6%96%87"],
    ["/api/webdav/node1/photos/?depth=1", "/api/webdav/node1/photos?depth=1"],
  ])("drops the collection slash of %s", (url, expected) => {
    expect(stripWebDavTrailingSlash(url)).toBe(expected);
  });

  it.each([
    "/api/webdav/node1",
    "/api/webdav/node1/a.txt",
    "/api/webdav/node1/a.txt?next=/x/",
    // An encoded slash is part of a name, not a separator.
    "/api/webdav/node1/a%2F",
  ])("leaves %s as it is", (url) => {
    expect(stripWebDavTrailingSlash(url)).toBe(url);
  });

  it("never touches a path outside the WebDAV route", () => {
    expect(stripWebDavTrailingSlash("/files/")).toBe("/files/");
    expect(stripWebDavTrailingSlash("/api/webdavx/")).toBe("/api/webdavx/");
    expect(stripWebDavTrailingSlash("/api/servers/")).toBe("/api/servers/");
  });

  it("maps exactly the verbs the App Router does not dispatch", () => {
    expect([...WEBDAV_OVERRIDE_METHODS].sort()).toEqual(["COPY", "LOCK", "MKCOL", "MOVE", "PROPFIND", "PROPPATCH", "UNLOCK"]);
    for (const standard of ["GET", "HEAD", "PUT", "DELETE", "POST", "OPTIONS"]) {
      expect(WEBDAV_OVERRIDE_METHODS.has(standard)).toBe(false);
    }
  });
});
