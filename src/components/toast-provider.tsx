"use client";

import { createContext, useContext, useState, useCallback, useEffect, useRef, type ReactNode } from "react";
import Link from "next/link";
import { useI18n } from "@/lib/i18n/use-locale";
import { AlertTriangle, Bell, Check, X } from "./icons";
import { IconButton } from "./ui-primitives";

type ToastType = "success" | "error" | "info" | "warning";

type ToastAction = { label: string; href: string };

type Toast = {
  id: string;
  type: ToastType;
  message: string;
  duration: number;
  action?: ToastAction;
};

/**
 * The third argument stays backwards compatible: older call sites pass a
 * plain duration number, newer ones pass `{ duration?, action? }`.
 */
type ToastOptions = number | { duration?: number; action?: ToastAction };

type ToastContextValue = {
  toasts: Toast[];
  addToast: (type: ToastType, message: string, options?: ToastOptions) => void;
  removeToast: (id: string) => void;
};

const ToastContext = createContext<ToastContextValue | null>(null);

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within <ToastProvider>");
  return ctx;
}

let toastCounter = 0;

/** Toast styling — uses CSS variables for full dark/light theme support */
const TOAST_STYLES: Record<ToastType, { container: string; icon: string }> = {
  success: { container: "text-[var(--success)]", icon: "bg-[var(--success-bg)] text-[var(--success)]" },
  error: { container: "text-[var(--danger)]", icon: "bg-[var(--danger-bg)] text-[var(--danger)]" },
  warning: { container: "text-[var(--warning)]", icon: "bg-[var(--warning-bg)] text-[var(--warning)]" },
  info: { container: "text-[var(--accent)]", icon: "bg-[var(--accent-bg)] text-[var(--accent)]" },
};

const TOAST_ICONS = {
  success: Check,
  error: X,
  warning: AlertTriangle,
  info: Bell,
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const { t } = useI18n();
  const [toasts, setToasts] = useState<Toast[]>([]);
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  useEffect(() => {
    const activeTimers = timers.current;
    return () => {
      for (const timer of activeTimers.values()) clearTimeout(timer);
      activeTimers.clear();
    };
  }, []);

  const removeToast = useCallback((id: string) => {
    clearTimeout(timers.current.get(id));
    timers.current.delete(id);
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const addToast = useCallback(
    (type: ToastType, message: string, options: ToastOptions = 4000) => {
      const id = `toast-${++toastCounter}`;
      const opts: { duration?: number; action?: ToastAction } =
        typeof options === "number" ? { duration: options } : options;
      const toast: Toast = {
        id,
        type,
        message,
        duration: opts.duration ?? 4000,
        action: opts.action,
      };
      setToasts((prev) => [...prev, toast]);

      if (toast.duration > 0) {
        timers.current.set(id, setTimeout(() => removeToast(id), toast.duration));
      }
    },
    [removeToast],
  );

  return (
    <ToastContext.Provider value={{ toasts, addToast, removeToast }}>
      {children}
      {/* Toast container */}
      <div className="pointer-events-none fixed bottom-[calc(4.75rem+env(safe-area-inset-bottom))] right-3 z-[var(--z-toast,60)] flex max-h-[calc(100dvh-6rem)] w-[min(24rem,calc(100vw-1.5rem))] flex-col gap-2 overflow-y-auto lg:bottom-5 lg:right-5">
        {toasts.map((toast) => {
          const style = TOAST_STYLES[toast.type];
          const Icon = TOAST_ICONS[toast.type];
          return (
            <div
              key={toast.id}
              role={toast.type === "error" ? "alert" : "status"}
              className={`pointer-events-auto flex shrink-0 items-center gap-3 rounded-[var(--radius-xl)] border border-[var(--border)] bg-[var(--modal-bg)] py-2.5 pl-3 pr-2 text-[13.5px] shadow-[var(--shadow-lg)] animate-toast-in ${style.container}`}
            >
              <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${style.icon}`}>
                <Icon size={15} aria-hidden />
              </span>
              <span className="min-w-0 flex-1 break-words leading-5 text-[var(--text-primary)]">{toast.message}</span>
              {toast.action ? (
                <Link
                  href={toast.action.href}
                  onClick={() => removeToast(toast.id)}
                  className="shrink-0 rounded-md bg-[var(--surface-elevated)] px-2 py-1 text-xs font-medium text-[var(--text-primary)] transition hover:bg-[var(--surface-hover)]"
                >
                  {toast.action.label}
                </Link>
              ) : null}
              <IconButton
                onClick={() => removeToast(toast.id)}
                className="h-8 w-8 shrink-0"
                label={t("common.close")}
              >
                <X size={16} aria-hidden />
              </IconButton>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}
