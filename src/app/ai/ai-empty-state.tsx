"use client";

/**
 * Empty-state panel for the AI chat surface.
 *
 * Renders when no `activeConv` is selected. Two variants:
 *   - no providers configured → CTA opens the provider panel.
 *   - providers exist         → CTA creates a new conversation.
 */
import { useI18n } from "@/lib/i18n/use-locale";
import { ActionButton } from "@/components/action-button";
import { Plus } from "@/components/icons";

import { Chip } from "@/components/ui-primitives";
type Props = {
  hasProviders: boolean;
  onOpenProviders: () => void;
  onNewConv: () => void;
  onOpenSidebar: () => void;
  /** Prefills the composer (creating a conversation first when needed). */
  onExample?: (prompt: string) => void;
};

/** Example prompts shown once a provider exists — they double as the
 *  capability advertisement (ops tools are this assistant's differentiator). */
const EXAMPLES: Array<{ id: string; prompt: string }> = [
  { id: "status", prompt: "查看所有服务器的当前状态，汇总 CPU / 内存 / 磁盘占用和告警。" },
  { id: "logs", prompt: "帮我读取服务器 的最近日志，分析有没有异常。" },
  { id: "disk", prompt: "列出各服务器磁盘占用最高的目录，并给出清理建议。" },
  { id: "traffic", prompt: "查询最近的流量数据，指出异常波动和可能的优化空间。" },
  { id: "cmd", prompt: "我想在服务器 上执行以下命令，请先评估风险再帮我执行：" },
];

export function AiEmptyState({
  hasProviders,
  onOpenProviders,
  onNewConv,
  onOpenSidebar,
  onExample,
}: Props) {
  const { t } = useI18n();
  const exampleLabel = (id: string) => {
    const key = `aiPage.slash.${id}`;
    const translated = t(key);
    return translated === key ? id : translated;
  };
  return (
    <div className="flex flex-1 flex-col items-center justify-center px-6 text-center text-[var(--text-muted)]">
      <div data-card className="p-0 w-full max-w-lg px-5 py-8 sm:p-8">
        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl border border-[var(--border)] bg-[var(--surface-elevated)] text-[var(--accent)]">
          <svg
            className="h-7 w-7 opacity-80"
            fill="none"
            stroke="currentColor"
            width="24" height="24" viewBox="0 0 24 24"
            aria-hidden="true"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.5}
              d="M9.75 3.104v5.714a2.25 2.25 0 01-.659 1.591L5 14.5M9.75 3.104c-.251.023-.501.09-.75.202-.25.112-.499.268-.75.468M9.75 3.104c.251.023.501.09.75.202.25.112.499.268.75.468M5 14.5l-1.43 1.43a2.25 2.25 0 01-3.182 0l-.03-.03a2.25 2.25 0 010-3.182L5 14.5zm0 0l6.25-6.25"
            />
          </svg>
        </div>
        {!hasProviders ? (
          <>
            <h1 className="ui-title-page">
              {t("aiPage.emptyNoProvider")}
            </h1>
            <p className="mt-3 text-sm leading-6 text-[var(--text-muted)]">
              {t("aiPage.emptyNoProviderHint")}
            </p>
            <ActionButton variant="primary"
              onClick={onOpenProviders}
              className="mt-5"
            >
              {t("aiPage.configProviders")}
            </ActionButton>
          </>
        ) : (
          <>
            <h1 className="ui-title-page mb-4">{t("aiPage.emptySelectConv")}</h1>
            <p className="mb-4 text-xs leading-5 text-[var(--text-muted)]">{t("aiPage.capabilityHint")}</p>
            {onExample && (
              <div className="mb-4 flex flex-wrap justify-center gap-2">
                {EXAMPLES.map((example) => (
                  <Chip
                    key={example.id}
                    onClick={() => onExample(example.prompt)}
                  >
                    {exampleLabel(example.id)}
                  </Chip>
                ))}
              </div>
            )}
            <div className="flex flex-col justify-center gap-2 sm:flex-row">
              <ActionButton variant="secondary" onClick={onOpenSidebar}>
                {t("aiPage.openConversations")}
              </ActionButton>
              <ActionButton icon={<Plus size={16} aria-hidden />} variant="primary" onClick={onNewConv}>
                {t("aiPage.newConversation")}
              </ActionButton>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
