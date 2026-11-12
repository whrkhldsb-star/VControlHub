"use client";

import { useId, useState } from "react";

import { useI18n } from "@/lib/i18n/use-locale";
import { UI_INPUT } from "@/lib/ui/classes";
import { cn } from "@/lib/ui/cn";

import { Eye, EyeOff } from "./icons";

type PasswordFieldProps = {
	label: string;
	name: "currentPassword" | "newPassword" | "confirmPassword";
	autoComplete: "current-password" | "new-password";
	placeholder?: string;
	description?: string;
};

/** A password field with a show/hide switch inside the field's own frame. */
export function PasswordField({ label, name, autoComplete, placeholder, description }: PasswordFieldProps) {
	const { t } = useI18n();
	const inputId = useId();
	const descriptionId = useId();
	const [visible, setVisible] = useState(false);

	return (
		<div className="grid gap-1.5">
			<label htmlFor={inputId} className="ui-label">{label}</label>
			<div className="relative">
				<input
					id={inputId}
					name={name}
					type={visible ? "text" : "password"}
					required
					autoComplete={autoComplete}
					placeholder={placeholder}
					aria-describedby={description ? descriptionId : undefined}
					className={cn(UI_INPUT, "pr-20")}
				/>
				<button
					type="button"
					aria-label={t(visible ? "changePassword.hideField" : "changePassword.showField", { label })}
					aria-pressed={visible}
					onClick={() => setVisible((current) => !current)}
					className="absolute inset-y-1 right-1 flex items-center gap-1 rounded-md px-2 text-xs font-medium text-[var(--text-secondary)] transition hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)]"
				>
					{visible ? <EyeOff size={14} aria-hidden /> : <Eye size={14} aria-hidden />}
					{visible ? t("changePassword.hide") : t("changePassword.show")}
				</button>
			</div>
			{description ? (
				<p id={descriptionId} className="text-xs leading-5 text-[var(--text-muted)]">{description}</p>
			) : null}
		</div>
	);
}
