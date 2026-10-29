import { describe, expect, it } from "vitest";
import { normalizeDownloadFileName } from "../helpers";
import { isPlainDownloadName } from "../file-name";
import { parseTransferManifest } from "../transfer-manifest";

const sha = "a".repeat(64);

describe("download file names", () => {
  it("accepts names with dots inside them", () => {
    // Ellipses and "a..b" are everyday torrent names; only a whole "." or ".." segment is dangerous.
    for (const name of ["Wait... What.mp4", "Vol.1..Vol.5.mkv", "a..b", ".hidden", "name."]) {
      expect(isPlainDownloadName(name)).toBe(true);
      expect(normalizeDownloadFileName(name)).toBe(name);
    }
  });

  it("refuses what the index and the server cannot hold", () => {
    for (const name of ["", ".", "..", "a/b", "a\\b", "C:evil", "line\nbreak", "nul\0byte", "x".repeat(256), "长".repeat(86)]) {
      expect(isPlainDownloadName(name)).toBe(false);
    }
    expect(() => normalizeDownloadFileName("..")).toThrow();
    expect(() => normalizeDownloadFileName("a\nb")).toThrow();
  });

  it("holds a torrent's transfer manifest to the same rule, before anything is sent", () => {
    // They used to disagree: the manifest let "Wait... What.mp4" through and the index then refused it after the
    // whole torrent had been copied to the server.
    expect(parseTransferManifest({ version: 1, files: [{ name: "Season 1/Wait... What.mp4", size: 1, sha256: sha }] })).not.toBeNull();
    expect(() => parseTransferManifest({ version: 1, files: [{ name: "Season 1/bad\nname.mp4", size: 1, sha256: sha }] })).toThrow();
    expect(() => parseTransferManifest({ version: 1, files: [{ name: "a/../b", size: 1, sha256: sha }] })).toThrow();
  });
});
