import { describe, expect, it } from "vitest";

import {
  buildSftpDirectProxyUrl,
  buildSftpDownloadHref,
  buildSftpDownloadUrl,
  buildSftpPreviewUrl,
  formatSftpFileSize,
  getSftpEntryIcon,
  getSftpPreviewMimeType,
  guessSftpFileIcon,
  isPreviewableSftpFile,
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

  it("builds preview URLs for real-time SFTP files", () => {
    expect(getSftpPreviewMimeType("demo file.mp4")).toBe("video/mp4");
    expect(getSftpPreviewMimeType("Dockerfile")).toBe("text/plain");
    expect(isPreviewableSftpFile("archive.bin")).toBe(false);
    expect(buildSftpPreviewUrl("node_1", "/媒体/demo file.mp4", "demo file.mp4")).toBe(
      "/files/preview?href=%2Fapi%2Fstorage%2Fsftp-download%3FnodeId%3Dnode_1%26path%3D%252F%25E5%25AA%2592%25E4%25BD%2593%252Fdemo%2Bfile.mp4&name=demo+file.mp4&type=video%2Fmp4&driver=SFTP&nodeId=node_1&relativePath=%2F%E5%AA%92%E4%BD%93%2Fdemo+file.mp4",
    );
  });

  it("builds direct proxy URLs without duplicating ports or leaking raw path segments", () => {
    expect(
      buildSftpDirectProxyUrl({
        publicUrl: "http://203.0.113.10:31888",
        port: 31888,
        remotePath: "/媒体/demo file.mp4",
        accessToken: "token value",
      }),
    ).toBe("http://203.0.113.10:31888/%E5%AA%92%E4%BD%93/demo%20file.mp4?token=token+value");
  });

  it("adds the proxy port when the server public URL is host-only", () => {
    expect(
      buildSftpDirectProxyUrl({
        publicUrl: "http://203.0.113.10",
        port: 31888,
        remotePath: "/movie.mp4",
        accessToken: "token",
      }),
    ).toBe("http://203.0.113.10:31888/movie.mp4?token=token");
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
