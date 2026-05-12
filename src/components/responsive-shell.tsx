"use client";

import Link from "next/link";
import { useState } from "react";
import { NotificationBell } from "./notification-bell";
import { ThemeToggle } from "./theme-toggle";
import { MobileNav } from "./mobile-nav";

const moreLinks = [
	{ href: "/requests", label: "审批中心" },
	{ href: "/users", label: "用户管理" },
	{ href: "/audit", label: "审计日志" },
	{ href: "/image-bed", label: "图床" },
	{ href: "/scheduled-tasks", label: "定时任务" },
	{ href: "/docker", label: "Docker" },
	{ href: "/notifications", label: "通知中心" },
	{ href: "/settings", label: "系统设置" },
];

export function MobileHeader() {
	return (
		<header className="sticky top-0 z-40 md:hidden border-b border-white/[0.06] bg-slate-950/95 backdrop-blur-xl">
			<div className="flex items-center justify-between h-12 px-4">
				<Link href="/" className="text-sm font-semibold text-white tracking-tight">
					VPS 管控平台
				</Link>
				<div className="flex items-center gap-1">
					<ThemeToggle />
					<NotificationBell />
				</div>
			</div>
		</header>
	);
}

export function MoreMenu() {
	const [open, setOpen] = useState(false);

	return (
		<>
			<div
				className="fixed inset-0 z-40 md:hidden bg-black/60 backdrop-blur-sm transition-opacity"
				style={{ opacity: open ? 1 : 0, pointerEvents: open ? "auto" : "none" }}
				onClick={() => setOpen(false)}
			/>
			<div
				className="fixed bottom-14 left-0 right-0 z-50 md:hidden bg-slate-950/98 border-t border-white/[0.06] backdrop-blur-xl transition-transform"
				style={{ transform: open ? "translateY(0)" : "translateY(100%)" }}
			>
				<div className="grid grid-cols-4 gap-2 p-4">
					{moreLinks.map((link) => (
						<Link
							key={link.href}
							href={link.href}
							onClick={() => setOpen(false)}
							className="flex flex-col items-center gap-1 py-3 rounded-xl hover:bg-white/[0.04] transition"
						>
							<span className="text-xs text-slate-300">{link.label}</span>
						</Link>
					))}
				</div>
			</div>
		</>
	);
}

export function ResponsiveShell({ children }: { children: React.ReactNode }) {
	return (
		<>
			<MobileHeader />
			<div className="pb-14 md:pb-0">
				{children}
			</div>
			<MobileNav />
		</>
	);
}
