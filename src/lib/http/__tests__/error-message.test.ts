import { describe, expect, it } from "vitest";
import { z } from "zod";

import { redirect } from "next/navigation";

import { ForbiddenError } from "@/lib/errors";
import { withApiCopyLocale } from "@/lib/i18n/api-copy";
import { browserT } from "@/lib/i18n/browser-translations";

import { describeFailure, getErrorMessage, readRefusal, refusalSentence, thrownActionMessage } from "../error-message";

/** What the browser gets, in a production build, for anything thrown on the server: React's sentence and a digest. */
const redacted = (digest: string) =>
  Object.assign(new Error("Minified React error #441; visit https://react.dev/errors/441 for the full message or use the non-minified dev environment for full errors and additional helpful warnings."), { digest });

/** The `t` a page hands over, in each language. */
const t = (key: string) => browserT(key, "zh");
const en = (key: string) => browserT(key, "en");

describe("getErrorMessage", () => {
  it("passes an error's own message through", () => {
    expect(getErrorMessage(new Error("SSH connection refused"), "fallback")).toBe("SSH connection refused");
    expect(getErrorMessage(new Error(""), "fallback")).toBe("fallback");
    expect(getErrorMessage("not an error", "fallback")).toBe("fallback");
  });

  it("never shows a database error's message", () => {
    // What server actions used to show for a duplicate name, verbatim.
    const unique = Object.assign(new Error("\nInvalid `prisma.sshKey.create()` invocation:\n\n\nUnique constraint failed on the fields: (`fingerprint`)"), {
      name: "PrismaClientKnownRequestError",
      code: "P2002",
      clientVersion: "7.9.0",
    });
    expect(getErrorMessage(unique, "Could not save the SSH key")).toBe("Could not save the SSH key");
    const validation = Object.assign(new Error("Invalid `prisma.role.findMany()` invocation"), { name: "PrismaClientValidationError", clientVersion: "7.9.0" });
    expect(getErrorMessage(validation, "Failed")).toBe("Failed");
  });

  it("shows what a schema refused, not the dump of its issues", () => {
    // What the server form showed for a host typed as a URL: `[\n  {\n    "code": "custom", …` (ZodError.message).
    const schema = z.object({
      name: z.string().min(2, "Node name must be at least 2 characters"),
      host: z.string().refine((value) => !value.includes("/"), "Host contains invalid characters"),
    });
    let thrown: unknown;
    try {
      schema.parse({ name: "a", host: "http://203.0.113.5" });
    } catch (error) {
      thrown = error;
    }
    expect(getErrorMessage(thrown, "Could not save")).toBe("Node name must be at least 2 characters; Host contains invalid characters");

    // In a Server Action the language is the request's: the sentences come out in it, joined as that language does.
    expect(withApiCopyLocale("zh", () => getErrorMessage(thrown, "保存失败"))).toBe("节点名称至少 2 个字符；主机地址包含无效字符");
    expect(withApiCopyLocale("en", () => getErrorMessage(thrown, "Could not save"))).toBe("Node name must be at least 2 characters; Host contains invalid characters");

    const repeated = z.array(z.string().min(1, "Tag cannot be empty")).safeParse(["", "", ""]).error;
    expect(getErrorMessage(repeated, "Could not save")).toBe("Tag cannot be empty");
    expect(getErrorMessage(new z.ZodError([]), "Could not save")).toBe("Could not save");
  });

  it("never shows what a production build puts in place of a server error's message", () => {
    // A Server Action that threw, as the rename dialog got it; and the same thing while a page renders on the server.
    const whileRendering = Object.assign(
      new Error("An error occurred in the Server Components render. The specific message is omitted in production builds to avoid leaking sensitive details. A digest property is included on this error instance which may provide additional details about the nature of the error."),
      { digest: "2574922165" },
    );
    expect(getErrorMessage(redacted("2574922165"), "重命名文件条目失败")).toBe("重命名文件条目失败");
    expect(getErrorMessage(whileRendering, "重命名文件条目失败")).toBe("重命名文件条目失败");
    expect(describeFailure("重命名文件条目失败", redacted("2574922165"))).toBe("重命名文件条目失败");
    // Where it is thrown, a refusal of ours has a digest too (so that it can be recognized after the crossing) and
    // keeps its message.
    expect(getErrorMessage(new ForbiddenError("缺少权限: storage:write"), "重命名文件条目失败")).toBe("缺少权限: storage:write");
  });

  it("words a Server Action that threw instead of answering", () => {
    const failed = "重命名文件条目失败";
    // The permission was taken away while the page was open: only the digest of the refusal survives.
    expect(thrownActionMessage(redacted("FORBIDDEN"), t, failed)).toBe("缺少权限");
    expect(thrownActionMessage(new ForbiddenError("缺少权限: storage:write"), t, failed)).toBe("缺少权限");
    // Anything else: the reason when it is one a person can read, else what failed.
    expect(thrownActionMessage(redacted("2574922165"), t, failed)).toBe("重命名文件条目失败");
    expect(thrownActionMessage(new Error("目标位置已存在同名条目"), t, failed)).toBe("目标位置已存在同名条目");
    expect(thrownActionMessage(undefined, t, failed)).toBe("重命名文件条目失败");
    // The session ran out and the action redirected to the sign-in page: the router is already going there.
    let signal: unknown;
    try {
      redirect("/login?next=%2F");
    } catch (error) {
      signal = error;
    }
    expect(signal).toBeInstanceOf(Error);
    expect(thrownActionMessage(signal, t, failed)).toBe("");
    expect(getErrorMessage(signal, "重命名文件条目失败")).toBe("重命名文件条目失败");
  });

  it("words what the router itself throws for a call that never reached the action", async () => {
    const failed = "重命名文件条目失败";
    // No answer at all: the browser's own wording is English and differs by engine.
    for (const browser of ["Failed to fetch", "Load failed", "NetworkError when attempting to fetch resource."]) {
      expect(thrownActionMessage(new TypeError(browser), t, failed)).toBe("无法连接到服务器，请检查网络后重试");
    }
    // The page is older than the server (an upgrade since it was loaded): the action it asks for is gone, and the
    // dialog showed `Server Action "40c0…" was not found on the server. Read more: https://nextjs.org/…`.
    const { UnrecognizedActionError } = await import("next/dist/client/components/unrecognized-action-error");
    const gone = new UnrecognizedActionError('Server Action "40c0ffee" was not found on the server. \nRead more: https://nextjs.org/docs/messages/failed-to-find-server-action');
    expect(thrownActionMessage(gone, t, failed)).toBe("页面版本已过期，请刷新页面后重试");
    // An answer the router could not read: a reverse proxy's error page in place of the app's.
    expect(thrownActionMessage(new Error("An unexpected response was received from the server."), t, failed)).toBe("服务器返回了无法识别的响应，请稍后重试");
    expect(thrownActionMessage(new TypeError("Failed to fetch"), en, "Rename failed")).toBe("Could not reach the server. Check your connection and try again.");
    expect(thrownActionMessage(gone, en, "Rename failed")).toBe("This page is out of date. Reload it and try again.");
  });

  it("holds the router's fixed sentence against the installed Next.js", async () => {
    // The sentence is matched as text: when an upgrade rewords it, this fails and the match must follow.
    const { readFileSync } = await import("node:fs");
    const { createRequire } = await import("node:module");
    const reducer = createRequire(import.meta.url).resolve("next/dist/client/components/router-reducer/reducers/server-action-reducer.js");
    expect(readFileSync(reducer, "utf8")).toContain("'An unexpected response was received from the server.'");
  });

  it("reads the sentence of a refusal for callers that take the response as it comes", async () => {
    // A download or a stream is asked for in raw mode, so its refusal is not thrown as an ApiError: the export
    // download showed the body itself, `{"error":"…","code":"FORBIDDEN","message":"…"}`.
    expect(refusalSentence({ code: "FORBIDDEN", error: "Forbidden", message: "缺少权限: deployment:export" })).toBe("缺少权限: deployment:export");
    expect(refusalSentence({ error: "导出不存在" })).toBe("导出不存在");
    expect(refusalSentence({ message: "  ", error: 42 })).toBe("");
    expect(refusalSentence(null)).toBe("");
    expect(refusalSentence("<html>502 Bad Gateway</html>")).toBe("");

    const refused = new Response(JSON.stringify({ code: "RATE_LIMITED", error: "请求过于频繁", message: "请求过于频繁，请稍后再试" }), { status: 429 });
    expect(await readRefusal(refused)).toBe("请求过于频繁，请稍后再试");
    // Not an answer of the app (a proxy in front of it, say): nothing to quote.
    expect(await readRefusal(new Response("<html>502 Bad Gateway</html>", { status: 502 }))).toBe("");
    expect(await readRefusal(new Response(null, { status: 500 }))).toBe("");
  });

  it("names what failed and why, or only what failed when the reason is not for people", () => {
    expect(describeFailure("Failed to trigger scan", new Error("No provider is configured"))).toBe("Failed to trigger scan: No provider is configured");
    // A thrown string, an empty message, a database error: no reason to show.
    expect(describeFailure("Failed to trigger scan", "status=403")).toBe("Failed to trigger scan");
    expect(describeFailure("Failed to trigger scan", new Error(""))).toBe("Failed to trigger scan");
    const database = Object.assign(new Error("Invalid `prisma.aiOpsLog.findMany()` invocation"), { name: "PrismaClientKnownRequestError", clientVersion: "7.9.0" });
    expect(describeFailure("Failed to load", database)).toBe("Failed to load");
  });
});
