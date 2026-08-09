"use client";

import { Children, useEffect, useRef, useState, type ReactNode } from "react";

import { ActionButton } from "@/components/action-button";
import { useI18n } from "@/lib/i18n/use-locale";

export function PaginatedList({
  children,
  pageSize = 20,
  resetKey,
  className,
}: {
  children: ReactNode;
  pageSize?: number;
  resetKey?: string | number;
  className?: string;
}) {
  const { t } = useI18n();
  const items = Children.toArray(children);
  const pageCount = Math.max(1, Math.ceil(items.length / pageSize));
  const [page, setPage] = useState(1);
  const safePage = Math.min(page, pageCount);
  const start = (safePage - 1) * pageSize;
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (page > pageCount) setPage(pageCount);
  }, [page, pageCount]);

  useEffect(() => {
    setPage(1);
  }, [resetKey]);

  const changePage = (next: number) => {
    setPage(next);
    rootRef.current?.scrollIntoView?.({ behavior: "smooth", block: "start" });
  };

  return (
    <div ref={rootRef} className={className}>
      {items.slice(start, start + pageSize)}
      {pageCount > 1 ? (
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--border)] px-4 py-3 sm:px-5">
          <span className="text-xs text-[var(--text-muted)]" aria-live="polite">
            {t("common.pagination.range", {
              start: start + 1,
              end: Math.min(start + pageSize, items.length),
              total: items.length,
            })}
          </span>
          <div className="flex items-center gap-2">
            <ActionButton variant="secondary" onClick={() => changePage(safePage - 1)} disabled={safePage === 1} className="!px-3 !py-1.5 !text-xs disabled:opacity-50">
              {t("common.pagination.previous")}
            </ActionButton>
            <span className="min-w-16 text-center text-xs text-[var(--text-secondary)]">{safePage} / {pageCount}</span>
            <ActionButton variant="secondary" onClick={() => changePage(safePage + 1)} disabled={safePage === pageCount} className="!px-3 !py-1.5 !text-xs disabled:opacity-50">
              {t("common.pagination.next")}
            </ActionButton>
          </div>
        </div>
      ) : null}
    </div>
  );
}
