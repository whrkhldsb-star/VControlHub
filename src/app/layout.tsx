import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

import { SidebarLoader } from "@/components/sidebar-loader";
import { ToastProvider } from "@/components/toast-provider";
import { StorageUploadProvider, StorageUploadStatus } from "@/components/storage/storage-upload-provider";
import { MobileNav } from "@/components/mobile-nav";
import { GlobalSearch } from "@/components/global-search";
import { AppTopbar } from "@/components/app-topbar";
import { KeyboardShortcuts } from "@/components/keyboard-shortcuts";
import { SkipLink } from "@/components/skip-link";
import { mainNavItems, systemNavItems } from "@/components/nav-items";
import { PwaRegister } from "@/components/pwa-register";
import { SentryProvider } from "@/components/sentry-provider";
import { WebVitalsReporter } from "@/components/web-vitals-reporter";
import { I18nProvider } from "@/lib/i18n/provider";
import { ThemeProvider } from "@/lib/theme/provider";
import { SshTerminalProvider } from "@/app/servers/ssh-terminal-context";
import { getAppMetadataTitle, getAppDescription, getAppName } from "@/lib/branding";
import { getSessionCookieName } from "@/lib/auth/session";
import { EMPTY_GATE, gateFromRoles } from "@/lib/auth/session-gate";
import { SessionGateProvider } from "@/lib/auth/session-context";
import { getCurrentSession } from "@/lib/auth/server-session";
import { loadSidebarDeclaredPermissions } from "@/lib/auth/declared-permissions";
import { type Locale } from "@/lib/i18n/translations";
import { type Theme } from "@/lib/theme/use-theme";
import { cookies, headers } from "next/headers";

const geistSans = Geist({
	variable: "--font-geist-sans",
	subsets: ["latin"],
});

const geistMono = Geist_Mono({
	variable: "--font-geist-mono",
	subsets: ["latin"],
});

export const metadata: Metadata = {
	title: getAppMetadataTitle(),
	description: getAppDescription(),
};

export default async function RootLayout({
	children,
}: Readonly<{
	children: React.ReactNode;
}>) {
	const cookieStore = await cookies();
	const headerStore = await headers();
	const nonce = headerStore.get("x-nonce") ?? undefined;
	const hasSessionCookie = Boolean(cookieStore.get(getSessionCookieName())?.value);
	const isPublicAuthPage = headerStore.get("x-vcontrolhub-public-auth-page") === "1";
	const shouldRenderAuthenticatedChrome = hasSessionCookie && !isPublicAuthPage;
	const localeCookie = cookieStore.get("vps-locale")?.value;
	const themeCookie = cookieStore.get("vps-theme")?.value;
	const sidebarCollapsed = cookieStore.get("vch-sidebar")?.value === "collapsed";
	const initialLocale: Locale = localeCookie === "en" ? "en" : "zh";
	const initialTheme: Theme = themeCookie === "light" ? "light" : "dark";

	// TR-030 / task 56: build a `SessionGate` server-side so the entire
	// authenticated chrome (sidebar + global search + mobile nav) shares the
	// same permission context. `getCurrentSession()` is React-cached so the
	// HMAC verify happens at most once per request even though SidebarLoader
	// also calls it. Empty gate when the cookie is missing / invalid → fail-
	// safe (every `can()` returns false → UI elements disappear).
	const session = shouldRenderAuthenticatedChrome ? await getCurrentSession() : null;
	const sessionGate = session ? gateFromRoles(session.roles, session.permissions, session.currentTeamId) : EMPTY_GATE;
	// TR-030: same permission map as SidebarLoader so ⌘K search cannot list
	// routes the user cannot open (filterItemsByPermissions is a no-op when empty).
	const declaredPermissionsByHref = shouldRenderAuthenticatedChrome
		? loadSidebarDeclaredPermissions([...mainNavItems, ...systemNavItems].map((item) => item.href))
		: {};

	return (
		<html
			lang={initialLocale === "zh" ? "zh-CN" : "en"}
			className={`${geistSans.variable} ${geistMono.variable} h-full antialiased ${initialTheme === "light" ? "light" : ""}`}
			data-sidebar={sidebarCollapsed ? "collapsed" : "expanded"}
			suppressHydrationWarning
		>
			<head>
				<meta name="session-cookie-name" content={getSessionCookieName()} />
				<script
					nonce={nonce}
					dangerouslySetInnerHTML={{
						__html:
							"globalThis.__zod_globalConfig={...(globalThis.__zod_globalConfig??{}),jitless:true};",
					}}
				/>
			</head>
			<body className="min-h-full">
				<ThemeProvider initialTheme={initialTheme}>
					<I18nProvider initialLocale={initialLocale}>
						<SentryProvider />
						{shouldRenderAuthenticatedChrome ? <WebVitalsReporter /> : null}
						<ToastProvider>
							<StorageUploadProvider key={`${session?.userId ?? "anonymous"}:${session?.currentTeamId ?? "personal"}`} scope={`${session?.userId ?? "anonymous"}:${session?.currentTeamId ?? "personal"}`}>
							<SshTerminalProvider>
							{shouldRenderAuthenticatedChrome ? <SkipLink /> : null}
							<div className="flex min-h-dvh min-w-0">
								{shouldRenderAuthenticatedChrome && (
									<SessionGateProvider value={sessionGate}>
										<SidebarLoader />
									</SessionGateProvider>
								)}
								<div className="flex min-w-0 flex-1 flex-col">
									{shouldRenderAuthenticatedChrome ? <AppTopbar appName={getAppName()} /> : null}
									<PwaRegister />
									<main
										id="main-content"
										tabIndex={-1}
										className={`min-w-0 flex-1 overflow-x-clip outline-none ${shouldRenderAuthenticatedChrome ? "pb-[calc(4.25rem+env(safe-area-inset-bottom))] lg:pb-0" : ""}`}
									>
										<StorageUploadStatus />
										{children}
									</main>
								</div>
							</div>
							{shouldRenderAuthenticatedChrome && (
								<SessionGateProvider value={sessionGate}>
									<MobileNav declaredPermissionsByHref={declaredPermissionsByHref} />
									<GlobalSearch declaredPermissionsByHref={declaredPermissionsByHref} />
									<KeyboardShortcuts />
								</SessionGateProvider>
							)}
							</SshTerminalProvider>
							</StorageUploadProvider>
						</ToastProvider>
					</I18nProvider>
				</ThemeProvider>
			</body>
		</html>
	);
}
