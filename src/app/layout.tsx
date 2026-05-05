import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

import { SidebarLoader } from "@/components/sidebar-loader";
import { ToastProvider } from "@/components/toast-provider";

const geistSans = Geist({
	variable: "--font-geist-sans",
	subsets: ["latin"],
});

const geistMono = Geist_Mono({
	variable: "--font-geist-mono",
	subsets: ["latin"],
});

export const metadata: Metadata = {
	title: "whrkhldsb | VPS 管理与分布式云盘",
	description: "统一 VPS 管理、审批执行、分布式云盘与媒体浏览平台",
};

export default function RootLayout({
	children,
}: Readonly<{
	children: React.ReactNode;
}>) {
	return (
		<html
			lang="zh-CN"
			className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
		>
			<body className="min-h-full flex flex-row">
				<ToastProvider>
					<SidebarLoader />
					<main className="flex-1 min-h-screen overflow-x-hidden">
						{children}
					</main>
				</ToastProvider>
			</body>
		</html>
	);
}
