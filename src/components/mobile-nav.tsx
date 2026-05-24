"use client";

import { usePathname } from "next/navigation";
import Link from "next/link";

const tabs = [
	{ href: "/", label: "仪表盘", icon: <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-4 0a1 1 0 01-1-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 01-1 1h-2z" /></svg> },
	{ href: "/servers", label: "服务器", icon: <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M5 12h14M5 12a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v4a2 2 0 01-2 2M5 12a2 2 0 00-2 2v4a2 2 0 002 2h14a2 2 0 002-2v-4a2 2 0 00-2-2m-2-4h.01M17 16h.01" /></svg> },
	{ href: "/traffic", label: "流量", icon: <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 17h16M4 12h5l2-5 4 10 2-5h3" /></svg> },
	{ href: "/files", label: "文件", icon: <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" /></svg> },
	{ href: "/downloads", label: "下载", icon: <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg> },
	{ href: "/more", label: "更多", icon: <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 6h16M4 12h16M4 18h16" /></svg> },
];

export function MobileNav() {
	const pathname = usePathname();

	return (
		<nav className="fixed bottom-0 left-0 right-0 z-50 md:hidden border-t border-white/[0.06] bg-slate-950/95 backdrop-blur-xl safe-area-inset">
			<div className="flex items-center justify-around h-14">
				{tabs.map((tab) => {
					const active = tab.href === "/" ? pathname === "/" : pathname.startsWith(tab.href);
					return (
						<Link
							key={tab.href}
							href={tab.href}
							className={`flex flex-col items-center gap-0.5 px-3 py-1 rounded-lg transition ${
								active ? "text-cyan-400" : "text-slate-500"
							}`}
						>
							{tab.icon}
							<span className="text-[10px]">{tab.label}</span>
						</Link>
					);
				})}
			</div>
		</nav>
	);
}
