"use client";

import { createContext, useContext, useState, useCallback, type ReactNode } from "react";

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

const TOAST_ICONS: Record<ToastType, string> = {
  success: "✓",
  error: "✕",
  warning: "⚠",
  info: "ℹ",
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const removeToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const addToast = useCallback(
    (type: ToastType, message: string, duration = 4000) => {
      const id = `toast-${++toastCounter}`;
      const toast: Toast = { id, type, message, duration };
      setToasts((prev) => [...prev, toast]);

      if (duration > 0) {
        setTimeout(() => removeToast(id), duration);
      }
    },
    [removeToast],
  );

  return (
    <ToastContext.Provider value={{ toasts, addToast, removeToast }}>
      {children}
      {/* Toast container */}
      <div className="fixed bottom-4 right-4 z-[var(--z-toast,60)] flex flex-col gap-2 pointer-events-none">
        {toasts.map((toast) => {
          const style = TOAST_STYLES[toast.type];
          return (
            <div
              key={toast.id}
              className={`pointer-events-auto flex items-center gap-3 rounded-xl border px-4 py-3 text-sm backdrop-blur-md transition-all duration-300 animate-in slide-in-from-right ${style.container}`}
            >
              <span className={`text-base font-bold ${style.icon}`}>
                {TOAST_ICONS[toast.type]}
              </span>
              <span className="text-[var(--text-primary)]">{toast.message}</span>
              <button
                type="button"
                onClick={() => removeToast(toast.id)}
                className="ml-1 text-[var(--text-muted)] transition hover:text-[var(--text-primary)]"
                aria-label="Close"
              >
                ✕
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}
