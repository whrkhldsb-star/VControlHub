"use client";

import { useTheme } from "@/lib/theme/use-theme";
import { useI18n } from "@/lib/i18n/use-locale";
import { IconMoon, IconSun } from "./nav-icons";

export function ThemeToggle({ compact = false }: { compact?: boolean } = {}) {
	const { theme, toggleTheme } = useTheme();
	const { t } = useI18n();
	const label = theme === "dark"
		? t("theme.toggleToLight")
		: t("theme.toggleToDark");

	return (
		<button
			type="button"
			onClick={toggleTheme}
			className={`relative flex items-center justify-center rounded-md text-[var(--text-muted)] transition hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)] ${
				compact ? "h-9 w-9" : "h-11 w-11"
			}`}
			aria-label={label}
			title={label}
		>
			{theme === "dark" ? <IconSun size={18} /> : <IconMoon size={18} />}
		</button>
	);
}
