import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

import { SidebarLoader } from "@/components/sidebar-loader";
import { ToastProvider } from "@/components/toast-provider";
import { MobileNav } from "@/components/mobile-nav";
import { GlobalSearch } from "@/components/global-search";
import { PwaRegister } from "@/components/pwa-register";
import { SentryProvider } from "@/components/sentry-provider";
import { WebVitalsReporter } from "@/components/web-vitals-reporter";
import { I18nProvider } from "@/lib/i18n/provider";
import { ThemeProvider } from "@/lib/theme/provider";
import { getAppMetadataTitle, getAppDescription } from "@/lib/branding";
import { getSessionCookieName } from "@/lib/auth/session";
import { EMPTY_GATE, gateFromRoles } from "@/lib/auth/session-gate";
import { SessionGateProvider } from "@/lib/auth/session-context";
import { getCurrentSession } from "@/lib/auth/server-session";
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
	const hasSessionCookie = Boolean(cookieStore.get(getSessionCookieName())?.value);
	const isPublicAuthPage = headerStore.get("x-vcontrolhub-public-auth-page") === "1";
	const shouldRenderAuthenticatedChrome = hasSessionCookie && !isPublicAuthPage;
	const localeCookie = cookieStore.get("vps-locale")?.value;
	const themeCookie = cookieStore.get("vps-theme")?.value;
	const initialLocale: Locale = localeCookie === "en" ? "en" : "zh";
	const initialTheme: Theme = themeCookie === "light" ? "light" : "dark";

	// TR-030 / task 56: build a `SessionGate` server-side so the entire
	// authenticated chrome (sidebar + global search + mobile nav) shares the
	// same permission context. `getCurrentSession()` is React-cached so the
	// HMAC verify happens at most once per request even though SidebarLoader
	// also calls it. Empty gate when the cookie is missing / invalid → fail-
	// safe (every `can()` returns false → UI elements disappear).
	const session = shouldRenderAuthenticatedChrome ? await getCurrentSession() : null;
	const sessionGate = session ? gateFromRoles(session.roles) : EMPTY_GATE;

	return (
		<html
			lang={initialLocale === "zh" ? "zh-CN" : "en"}
			className={`${geistSans.variable} ${geistMono.variable} h-full antialiased ${initialTheme === "light" ? "light" : ""}`}
			suppressHydrationWarning
		>
			<head>
				<meta name="session-cookie-name" content={getSessionCookieName()} />
			</head>
			<body className="min-h-full flex flex-row">
				<ThemeProvider initialTheme={initialTheme}>
					<I18nProvider initialLocale={initialLocale}>
						<SentryProvider />
						<WebVitalsReporter />
						<ToastProvider>
							{shouldRenderAuthenticatedChrome && (
								<SessionGateProvider value={sessionGate}>
									<SidebarLoader />
								</SessionGateProvider>
							)}
							<PwaRegister />
							<main className="min-h-screen min-w-0 flex-1 overflow-x-clip pb-[calc(5.5rem+env(safe-area-inset-bottom))] md:pb-0">
								{children}
							</main>
							{shouldRenderAuthenticatedChrome && (
								<SessionGateProvider value={sessionGate}>
									<MobileNav />
									<GlobalSearch />
								</SessionGateProvider>
							)}
						</ToastProvider>
					</I18nProvider>
				</ThemeProvider>
			</body>
		</html>
	);
}
