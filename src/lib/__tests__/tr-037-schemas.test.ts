import { describe, expect, it } from "vitest";

import {
  createAnnouncementSchema,
  updateAnnouncementSchema,
} from "../announcement/schema";
import {
  createSnippetSchema,
  updateSnippetSchema,
} from "../snippet/schema";
import {
  createUserSchema,
  updateUserSchema,
} from "../user/schema";

describe("createSnippetSchema", () => {
  it("合法 payload 通过", () => {
    const out = createSnippetSchema.parse({
      title: "  hello ",
      content: "code",
      tags: ["a", "b"],
    });
    expect(out.title).toBe("hello"); // trimmed
    expect(out.tags).toEqual(["a", "b"]);
  });

  it("空 title 拒绝", () => {
    expect(() => createSnippetSchema.parse({ title: "  ", content: "x" })).toThrow();
  });

  it("title 超过 120 拒绝", () => {
    expect(() =>
      createSnippetSchema.parse({ title: "x".repeat(121), content: "x" }),
    ).toThrow();
  });

  it("tags 超过 20 拒绝", () => {
    expect(() =>
      createSnippetSchema.parse({
        title: "t",
        content: "c",
        tags: Array.from({ length: 21 }, () => "x"),
      }),
    ).toThrow();
  });
});

describe("updateSnippetSchema", () => {
  it("至少一个更新字段", () => {
    expect(() => updateSnippetSchema.parse({ id: "x" })).toThrow();
  });

  it("只改 title 合法", () => {
    const out = updateSnippetSchema.parse({ id: "x", title: "new" });
    expect(out).toEqual({ id: "x", title: "new" });
  });
});

describe("createAnnouncementSchema", () => {
  it("title 必填,content 必填", () => {
    expect(() => createAnnouncementSchema.parse({})).toThrow();
    expect(() => createAnnouncementSchema.parse({ title: "" })).toThrow();
  });

  it("type 仅允许 info/warning/urgent", () => {
    expect(() =>
      createAnnouncementSchema.parse({
        title: "t",
        content: "c",
        type: "nope",
      }),
    ).toThrow();
    const ok = createAnnouncementSchema.parse({ title: "t", content: "c", type: "warning" });
    expect(ok.type).toBe("warning");
  });

  it("expiresAt 接受 ISO datetime 字符串", () => {
    const ok = createAnnouncementSchema.parse({
      title: "t",
      content: "c",
      expiresAt: "2026-12-31T00:00:00Z",
    });
    expect(typeof ok.expiresAt).toBe("string");
  });

  it("expiresAt 接受 null (清空)", () => {
    const ok = createAnnouncementSchema.parse({
      title: "t",
      content: "c",
      expiresAt: null,
    });
    expect(ok.expiresAt).toBeNull();
  });

  it("expiresAt 拒绝非 ISO 字符串", () => {
    expect(() =>
      createAnnouncementSchema.parse({
        title: "t",
        content: "c",
        expiresAt: "tomorrow",
      }),
    ).toThrow();
  });
});

describe("updateAnnouncementSchema", () => {
  it("至少一个更新字段", () => {
    expect(() => updateAnnouncementSchema.parse({ id: "x" })).toThrow();
  });

  it("id 必填", () => {
    expect(() => updateAnnouncementSchema.parse({ title: "x" })).toThrow();
  });

  it("合法 patch 通过", () => {
    const out = updateAnnouncementSchema.parse({ id: "x", published: true });
    expect(out).toEqual({ id: "x", published: true });
  });
});

describe("createUserSchema", () => {
  it("合法 payload", () => {
    const out = createUserSchema.parse({
      username: "alice",
      password: "Secret123",
      roleKeys: ["viewer"],
    });
    expect(out.username).toBe("alice");
  });

  it("username 不足 2 字符拒绝", () => {
    expect(() =>
      createUserSchema.parse({ username: "a", password: "Secret123" }),
    ).toThrow();
  });

  it("username 含非法字符拒绝", () => {
    expect(() =>
      createUserSchema.parse({ username: "al ice", password: "Secret123" }),
    ).toThrow();
    expect(() =>
      createUserSchema.parse({ username: "al/ice", password: "Secret123" }),
    ).toThrow();
  });

  it("password 不足 6 字符拒绝", () => {
    expect(() =>
      createUserSchema.parse({ username: "alice", password: "123" }),
    ).toThrow();
  });

  it("roleKeys 接受空字符串数组 (route 负责去重)", () => {
    const out = createUserSchema.parse({
      username: "alice",
      password: "Secret123",
      roleKeys: ["viewer", ""],
    });
    expect(out.roleKeys).toEqual(["viewer", ""]);
  });
});

describe("updateUserSchema", () => {
  it("至少一个更新字段", () => {
    expect(() => updateUserSchema.parse({ userId: "u1" })).toThrow();
  });

  it("reset_password 必须带 newPassword", () => {
    expect(() =>
      updateUserSchema.parse({ userId: "u1", action: "reset_password" }),
    ).toThrow();
  });

  it("reset_password + newPassword 合法", () => {
    const out = updateUserSchema.parse({
      userId: "u1",
      action: "reset_password",
      newPassword: "NewSecret123",
    });
    expect(out.action).toBe("reset_password");
    expect(out.newPassword).toBe("NewSecret123");
  });

  it("不支持的 action 拒绝", () => {
    expect(() =>
      updateUserSchema.parse({ userId: "u1", action: "purge" }),
    ).toThrow();
  });
});
