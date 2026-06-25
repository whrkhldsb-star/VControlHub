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
      data-action-button={className ? undefined : ""}
      data-variant={className ? undefined : "primary"}
      className={className}
    >
      {pending ? pendingLabel : children}
    </button>
  );
}
