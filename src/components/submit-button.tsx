"use client";

import { useFormStatus } from "react-dom";

export function SubmitButton({
  pendingLabel,
  children,
  className,
  name,
  value,
  disabled,
}: {
  pendingLabel: string;
  children: React.ReactNode;
  className?: string;
  name?: string;
  value?: string;
  disabled?: boolean;
}) {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      name={name}
      value={value}
      disabled={pending || disabled}
      className={className ?? "rounded-2xl bg-cyan-500 px-4 py-2 text-sm font-medium text-slate-950 transition hover:bg-cyan-400 disabled:cursor-not-allowed disabled:opacity-60"}
    >
      {pending ? pendingLabel : children}
    </button>
  );
}
