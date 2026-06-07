import { describe, expect, it } from "vitest";

import { getDomTextTranslation } from "../dom-translations";

describe("DOM i18n fallback catalog", () => {
  it("translates server-rendered backup page copy that is not wired to useI18n yet", () => {
    expect(getDomTextTranslation("备份与迁移", "en")).toBe("Backups & Migration");
    expect(getDomTextTranslation("创建定时备份", "en")).toBe("Create scheduled backup");
    expect(getDomTextTranslation("只有 COMPLETED 状态的备份可以执行恢复。", "en")).toBe("Only COMPLETED backups can be restored.");
  });

  it("keeps Chinese text unchanged in zh mode", () => {
    expect(getDomTextTranslation("备份与迁移", "zh")).toBe("备份与迁移");
  });

  it("translates common dynamic backup summaries", () => {
    expect(getDomTextTranslation("共 12 条记录", "en")).toBe("Total 12 records");
    expect(getDomTextTranslation("3 条完成备份超过 30 天，建议复核清理", "en")).toBe("3 completed backups are older than 30 days; review cleanup is recommended");
    expect(getDomTextTranslation("大小：6.0 MB", "en")).toBe("Size: 6.0 MB");
    expect(getDomTextTranslation("完成：未完成", "en")).toBe("Completed: Not completed");
    expect(getDomTextTranslation("最大：DATABASE · 46.9 KB", "en")).toBe("Largest: DATABASE · 46.9 KB");
    expect(getDomTextTranslation("0 个 · 待生成", "en")).toBe("0 item(s) · Pending generation");
  });

  it("leaves unknown strings untouched so user data and filenames are not mistranslated", () => {
    expect(getDomTextTranslation("qa_canary_20260603.txt", "en")).toBe("qa_canary_20260603.txt");
  });
});
