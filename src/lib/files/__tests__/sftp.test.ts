import { describe, expect, it } from "vitest";

import {
  buildSftpDownloadHref,
  buildSftpDownloadUrl,
  formatSftpFileSize,
  getSftpEntryIcon,
  guessSftpFileIcon,
  isViewableSftpTextFile,
  joinSftpPath,
  splitSftpPath,
} from "../sftp";

describe("SFTP file helpers", () => {
  it("formats file sizes defensively", () => {
    expect(formatSftpFileSize(null)).toBe("-");
    expect(formatSftpFileSize(-1)).toBe("-");
    expect(formatSftpFileSize(512)).toBe("512 B");
    expect(formatSftpFileSize(1536)).toBe("1.5 KB");
    expect(formatSftpFileSize(2 * 1024 * 1024)).toBe("2.0 MB");
  });

  it("joins and splits remote paths without duplicate slashes", () => {
    expect(joinSftpPath("/", "logs")).toBe("/logs");
    expect(joinSftpPath("/var/", "/log/app.log")).toBe("/var/log/app.log");
    expect(splitSftpPath("/var// log /app")).toEqual(["var", "log", "app"]);
  });

  it("builds encoded download endpoints", () => {
    expect(buildSftpDownloadHref("node 1", "/var/log/app.log")).toBe("/api/storage/sftp-download?nodeId=node+1&path=%2Fvar%2Flog%2Fapp.log");
    expect(buildSftpDownloadUrl("node 1", "/var/log/app.log")).toBe("/api/storage/sftp-download?nodeId=node+1&path=%2Fvar%2Flog%2Fapp.log&download=1");
  });

  it("classifies entry and file icons plus editable text files", () => {
    expect(getSftpEntryIcon("directory")).toBe("📁");
    expect(getSftpEntryIcon("other")).toBe("📎");
    expect(guessSftpFileIcon("photo.webp")).toBe("🖼️");
    expect(guessSftpFileIcon("archive.tar")).toBe("📦");
    expect(isViewableSftpTextFile("Dockerfile")).toBe(true);
    expect(isViewableSftpTextFile("server.log")).toBe(true);
    expect(isViewableSftpTextFile("movie.mp4")).toBe(false);
  });
});
