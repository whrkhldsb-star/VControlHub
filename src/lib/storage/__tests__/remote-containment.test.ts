import { expect, it, vi } from "vitest";
import { ValidationError } from "@/lib/errors";
import { resolveRemoteRealPath } from "@/lib/ssh/client";
import { assertRemotePathContained } from "../remote-containment";

vi.mock("@/lib/ssh/client", () => ({
  resolveRemoteRealPath: vi.fn(),
  RemoteDanglingLinkError: class extends Error {},
}));

const ssh = { host: "sftp.test", port: 22, username: "files" };

it.each([
  ["/store", "/store\\docs/file"],
  ["/C:/store", "/c:/store/docs/file"],
])("compares POSIX real paths literally under %s", async (root, other) => {
  vi.mocked(resolveRemoteRealPath).mockResolvedValueOnce(root).mockResolvedValueOnce(other);
  await expect(assertRemotePathContained(ssh, root, root + "/docs/file")).rejects.toBeInstanceOf(ValidationError);
});

it("accepts literal backslashes in the resolved POSIX root", async () => {
  vi.mocked(resolveRemoteRealPath).mockResolvedValueOnce("/volume/a\\b").mockResolvedValueOnce("/volume/a\\b/docs");
  await expect(assertRemotePathContained(ssh, "/store", "/store/docs")).resolves.toBe("/volume/a\\b/docs");
});

it("accepts Windows OpenSSH drive, separator and case variants on a confirmed Windows host", async () => {
  vi.mocked(resolveRemoteRealPath).mockResolvedValueOnce("D:\\Store").mockResolvedValueOnce("/d:/STORE/Docs");
  await expect(assertRemotePathContained({ ...ssh, windowsOpenSsh: true }, "/D:/Store", "/D:/Store/docs"))
    .resolves.toBe("/d:/STORE/Docs");
});
