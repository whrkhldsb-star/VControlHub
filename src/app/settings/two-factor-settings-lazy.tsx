/**
 * Dynamic wrapper around `TwoFactorSettings`.
 *
 * TR-036: the 2FA setup panel only renders when the user expands the
 * "2FA" section in /settings. Routing it through `next/dynamic` defers
 * the import graph (TOTP setup, QR code generation, csrfFetch) until
 * the section is actually opened. Stub preserves the section's
 * vertical space so the disclosure does not jump on click.
 *
 * `ssr: false` is correct: the component uses `useRouter`,
 * `useState`, and csrf calls — none of which have value during
 * pre-render. Importantly, *not* rendering on the server means we
 * avoid SSR-ing the OTP-setup state machine into a static page that
 * the user can never reach without clicking first.
 *
 * Prop types are read via `ComponentProps<typeof import(...)>` — a
 * TypeScript-only construct that webpack does not follow, so the
 * real component is NOT pulled back into the parent chunk.
 */
"use client";

import dynamic from "next/dynamic";
import type { ComponentProps, ComponentType } from "react";

type TwoFactorSettingsProps = ComponentProps<
	typeof import("@/components/two-factor-settings").TwoFactorSettings
>;

function TwoFactorSettingsStub() {
	return (
		<div
			aria-hidden
			data-testid="two-factor-settings-loading"
			className="space-y-3"
		>
			<div className="h-4 w-2/3 animate-pulse rounded bg-[var(--surface)]/[0.06]" />
			<div className="h-10 w-full animate-pulse rounded-lg bg-[var(--surface)]/[0.04]" />
			<div className="h-10 w-1/3 animate-pulse rounded-lg bg-[var(--surface)]/[0.04]" />
		</div>
	);
}

export const TwoFactorSettingsLazy: ComponentType<TwoFactorSettingsProps> =
	dynamic(
		() =>
			import("@/components/two-factor-settings").then(
				(m) => m.TwoFactorSettings,
			),
		{ ssr: false, loading: () => <TwoFactorSettingsStub /> },
	);

export type { TwoFactorSettingsProps };
