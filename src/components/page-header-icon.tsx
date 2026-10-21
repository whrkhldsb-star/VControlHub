"use client";

import type { ReactNode } from "react";
import { usePathname } from "next/navigation";

import { IconKey, IconShield } from "./nav-icons";
import { findNavLocation } from "./nav-items";

/** Account pages live in the account menu rather than the navigation. */
const ACCOUNT_ICONS: Array<[prefix: string, icon: ReactNode]> = [
	["/account/password", <IconKey key="password" />],
	["/account", <IconShield key="account" />],
];

/**
 * The navigation glyph of the page being shown, as the tile beside its
 * title. Pages outside the navigation and the account menu (share links,
 * public pages) get none.
 */
export function PageHeaderIcon() {
	const pathname = usePathname();
	if (!pathname) return null;
	const icon = findNavLocation(pathname)?.item.icon ?? ACCOUNT_ICONS.find(([prefix]) => pathname === prefix || pathname.startsWith(`${prefix}/`))?.[1];
	if (!icon) return null;
	return (
		<span data-page-icon aria-hidden="true">
			{icon}
		</span>
	);
}
