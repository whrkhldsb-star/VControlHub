"use client";

/**
 * useActionResultToast — 一行调用处理 ActionResult 反馈（TR-026）
 *
 * 用法：
 *   const handle = useActionResultToast();
 *   const r = await someAction();
 *   if (handle(r)) {
 *     // 仅成功路径才进入这里
 *   }
 */

import { useCallback } from "react";
import type { ActionResult } from "@/lib/http/action-result";
import { useToast } from "@/components/toast-provider";

export type UseActionResultToastOptions = {
  /** 成功时是否显示 toast（默认 true） */
  showSuccess?: boolean;
  /** 默认成功文案（result.message 优先） */
  successMessage?: string;
};

export function useActionResultToast(defaults: UseActionResultToastOptions = {}) {
  const { addToast } = useToast();

  return useCallback(
    <T,>(result: ActionResult<T>, perCall: UseActionResultToastOptions = {}): result is { ok: true; data?: T; message?: string; taskHref?: string } => {
      const showSuccess = perCall.showSuccess ?? defaults.showSuccess ?? true;
      const successMessage = perCall.successMessage ?? defaults.successMessage ?? "Operation succeeded";

      if (result.ok) {
        if (showSuccess) {
          const msg = result.message ?? successMessage;
          addToast("success", msg);
        }
        return true;
      }

      // 失败路径：按 code 调整 toast type
      const type = result.code === "RATE_LIMITED" || result.code === "PARTIAL_FAILURE" ? "warning" : "error";
      let msg = result.message;

      // 部分失败时附加摘要
      if (result.code === "PARTIAL_FAILURE" && Array.isArray(result.partial)) {
        const failed = result.partial.filter((p) => !p.ok).length;
        const total = result.partial.length;
        msg = `${msg} (${failed}/${total} failed)`;
      }

      // 校验失败时附加首个字段错误
      if (result.code === "VALIDATION_FAILED" && result.details && typeof result.details === "object") {
        const detailsRecord = result.details as Record<string, string[]>;
        const firstField = Object.keys(detailsRecord)[0];
        if (firstField && Array.isArray(detailsRecord[firstField]) && detailsRecord[firstField][0]) {
          msg = `${msg}: ${detailsRecord[firstField][0]}`;
        }
      }

      addToast(type, msg);
      return false;
    },
    [addToast, defaults.showSuccess, defaults.successMessage],
  );
}
