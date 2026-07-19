"use client";

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { SshTerminalManager, type SshTerminalTab } from "@/components/ssh-terminal-manager";
import type { TerminalStatus } from "@/components/ssh-terminal-panel";

/* ------------------------------------------------------------------ */
/* SshTerminalProvider — global multi-tab SSH terminal state          */
/* ------------------------------------------------------------------ */

type SshTerminalContextValue = {
	/** Open a terminal tab for a server. If already open, switch to it. */
	openTerminal: (server: {
		serverId: string;
		serverName: string;
		host: string;
		sessionToken: string;
	}) => void;
	/** Whether any terminal tabs are open. */
	isOpen: boolean;
};

const SshTerminalContext = createContext<SshTerminalContextValue | null>(null);

export function useSshTerminal() {
	const ctx = useContext(SshTerminalContext);
	if (!ctx) throw new Error("useSshTerminal must be used within SshTerminalProvider");
	return ctx;
}

let tabNonce = 0;

export function SshTerminalProvider({ children }: { children: ReactNode }) {
	const [tabs, setTabs] = useState<SshTerminalTab[]>([]);
	const [activeTabIndex, setActiveTabIndex] = useState(0);

	const openTerminal = useCallback((server: {
		serverId: string;
		serverName: string;
		host: string;
		sessionToken: string;
	}) => {
		setTabs((prev) => {
			// If a tab for this serverId already exists, switch to it
			const existingIdx = prev.findIndex((t) => t.serverId === server.serverId);
			if (existingIdx >= 0) {
				setActiveTabIndex(existingIdx);
				return prev;
			}
			// Create a new tab
			const newTab: SshTerminalTab = {
				id: `${server.serverId}-${++tabNonce}`,
				serverId: server.serverId,
				serverName: server.serverName,
				host: server.host,
				sessionToken: server.sessionToken,
				status: "connecting",
			};
			setActiveTabIndex(prev.length); // switch to the new tab
			return [...prev, newTab];
		});
	}, []);

	const closeTab = useCallback((index: number) => {
		// Functional update for active index: closeTab closes over activeTabIndex
		// would otherwise use a stale value when several tabs close quickly
		// (Escape spam / multi-close) before the provider re-renders.
		setTabs((prev) => {
			if (index < 0 || index >= prev.length) return prev;
			const next = prev.filter((_, i) => i !== index);
			setActiveTabIndex((currentActive) => {
				if (next.length === 0) return 0;
				if (index < currentActive) return currentActive - 1;
				if (index === currentActive) {
					return Math.min(currentActive, next.length - 1);
				}
				return currentActive;
			});
			return next;
		});
	}, []);

	const closeAll = useCallback(() => {
		setTabs([]);
		setActiveTabIndex(0);
	}, []);

	const handleStatusChange = useCallback((index: number, status: TerminalStatus) => {
		setTabs((prev) => {
			if (index < 0 || index >= prev.length) return prev;
			const tab = prev[index]!;
			if (tab.status === status) return prev;
			const next = [...prev];
			next[index] = { ...tab, status };
			return next;
		});
	}, []);

	const value = useMemo<SshTerminalContextValue>(
		() => ({ openTerminal, isOpen: tabs.length > 0 }),
		[openTerminal, tabs.length],
	);

	return (
		<SshTerminalContext.Provider value={value}>
			{children}
			{tabs.length > 0 && (
				<SshTerminalManager
					tabs={tabs}
					activeTabIndex={Math.min(activeTabIndex, tabs.length - 1)}
					onTabSelect={setActiveTabIndex}
					onTabClose={closeTab}
					onClose={closeAll}
					onStatusChange={handleStatusChange}
				/>
			)}
		</SshTerminalContext.Provider>
	);
}
