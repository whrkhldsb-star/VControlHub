"use client";

import { createContext, useContext, useState, useCallback, useEffect, useRef, type ReactNode } from "react";
import { useI18n } from "@/lib/i18n/use-locale";
import { AlertTriangle, Bell, Check, X } from "./icons";
import { IconButton } from "./ui-primitives";

type ToastType = "success" | "error" | "info" | "warning";

type Toast = {
  id: string;
  type: ToastType;
  message: string;
  duration?: number;
};

type ToastContextValue = {
  toasts: Toast[];
  addToast: (type: ToastType, message: string, duration?: number) => void;
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
  success: {
    container:
      "border-[var(--success-border)] bg-[var(--surface)] text-[var(--success)] shadow-lg",
    icon: "text-[var(--success)]",
  },
  error: {
    container:
      "border-[var(--danger-border)] bg-[var(--surface)] text-[var(--danger)] shadow-lg",
    icon: "text-[var(--danger)]",
  },
  warning: {
    container:
      "border-[var(--warning-border)] bg-[var(--surface)] text-[var(--warning)] shadow-lg",
    icon: "text-[var(--warning)]",
  },
  info: {
    container:
      "border-[var(--accent-border)] bg-[var(--surface)] text-[var(--accent)] shadow-lg",
    icon: "text-[var(--accent)]",
  },
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
    (type: ToastType, message: string, duration = 4000) => {
      const id = `toast-${++toastCounter}`;
      const toast: Toast = { id, type, message, duration };
      setToasts((prev) => [...prev, toast]);

      if (duration > 0) {
        timers.current.set(id, setTimeout(() => removeToast(id), duration));
      }
    },
    [removeToast],
  );

  return (
    <ToastContext.Provider value={{ toasts, addToast, removeToast }}>
      {children}
      {/* Toast container */}
      <div className="pointer-events-none fixed bottom-[calc(4.75rem+env(safe-area-inset-bottom))] right-3 z-[var(--z-toast,60)] flex max-h-[calc(100dvh-6rem)] max-w-[min(24rem,calc(100vw-1.5rem))] flex-col gap-2 overflow-y-auto md:bottom-4 md:right-4">
        {toasts.map((toast) => {
          const style = TOAST_STYLES[toast.type];
          const Icon = TOAST_ICONS[toast.type];
          return (
            <div
              key={toast.id}
              role={toast.type === "error" ? "alert" : "status"}
              className={`pointer-events-auto flex shrink-0 items-center gap-3 rounded-lg border px-4 py-3 text-sm transition-all duration-300 animate-in slide-in-from-right ${style.container}`}
            >
              <Icon size={18} aria-hidden className={`shrink-0 ${style.icon}`} />
              <span className="min-w-0 flex-1 break-words text-[var(--text-primary)]">{toast.message}</span>
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
