"use client";

import { useI18n } from "@/lib/i18n/use-locale";
import { ArrowLeft, ChevronRight } from "./icons";
import { IconButton } from "./ui-primitives";

export function Pagination({
  page,
  pageSize,
  totalItems,
  onPageChange,
  onPageSizeChange,
  loading = false,
}: {
  page: number;
  pageSize: number;
  totalItems: number;
  onPageChange: (page: number) => void;
  onPageSizeChange?: (pageSize: number) => void;
  loading?: boolean;
}) {
  const { t } = useI18n();
  const pages = Math.max(1, Math.ceil(totalItems / pageSize));
  return (
    <nav
      aria-label={t("common.pagination.label")}
      className="flex min-w-0 flex-wrap items-center justify-between gap-3 border-t border-[var(--border)] py-3 text-xs text-[var(--text-secondary)]"
    >
      <span aria-live="polite">
        {t("common.pagination.range", {
          start: totalItems ? (page - 1) * pageSize + 1 : 0,
          end: Math.min(page * pageSize, totalItems),
          total: totalItems,
        })}
      </span>
      {onPageSizeChange ? (
          <select
            aria-label={t("common.pagination.pageSize")}
            value={pageSize}
            disabled={loading}
            onChange={(event) => onPageSizeChange(Number(event.target.value))}
            className="h-9 rounded-md border border-[var(--input-border)] bg-[var(--input-bg)] px-2"
          >
            {[25, 50, 100, 200].map((size) => (
              <option key={size} value={size}>
                {size}
              </option>
            ))}
          </select>
      ) : null}
      <div className="flex items-center gap-2">
        <IconButton
          label={t("common.pagination.previous")}
          disabled={loading || page <= 1}
          onClick={() => onPageChange(page - 1)}
        >
          <ArrowLeft size={16} aria-hidden />
        </IconButton>
        <form
          key={page}
          className="flex items-center gap-1"
          onSubmit={(event) => {
            event.preventDefault();
            const value = Number(new FormData(event.currentTarget).get("page"));
            if (
              Number.isInteger(value) &&
              value >= 1 &&
              value <= pages &&
              value !== page
            )
              onPageChange(value);
          }}
        >
          <input
            name="page"
            type="number"
            min={1}
            max={pages}
            defaultValue={page}
            disabled={loading}
            aria-label={t("common.pagination.page")}
            className="h-9 w-16 rounded-md border border-[var(--input-border)] bg-[var(--input-bg)] px-2 text-center tabular-nums"
          />
          <span className="tabular-nums">/ {pages}</span>
          <IconButton
            label={t("common.pagination.go")}
            type="submit"
            disabled={loading}
          >
            <ChevronRight size={14} aria-hidden />
          </IconButton>
        </form>
        <IconButton
          label={t("common.pagination.next")}
          disabled={loading || page >= pages}
          onClick={() => onPageChange(page + 1)}
        >
          <ChevronRight size={18} aria-hidden />
        </IconButton>
      </div>
    </nav>
  );
}
