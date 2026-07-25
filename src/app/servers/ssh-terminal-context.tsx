"use client";

import { createContext, useCallback, useContext, useMemo, useReducer, type ReactNode } from "react";
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

type TerminalState = {
	tabs: SshTerminalTab[];
	activeTabIndex: number;
};

type TerminalAction =
	| {
			type: "open";
			server: {
				serverId: string;
				serverName: string;
				host: string;
				sessionToken: string;
			};
	  }
	| { type: "close"; index: number }
	| { type: "closeAll" }
	| { type: "select"; index: number }
	| { type: "status"; index: number; status: TerminalStatus };

function terminalReducer(state: TerminalState, action: TerminalAction): TerminalState {
	switch (action.type) {
		case "open": {
			const existingIdx = state.tabs.findIndex((t) => t.serverId === action.server.serverId);
			if (existingIdx >= 0) {
				return existingIdx === state.activeTabIndex
					? state
					: { ...state, activeTabIndex: existingIdx };
			}
			const newTab: SshTerminalTab = {
				id: `${action.server.serverId}-${++tabNonce}`,
				serverId: action.server.serverId,
				serverName: action.server.serverName,
				host: action.server.host,
				sessionToken: action.server.sessionToken,
				status: "connecting",
			};
			return {
				tabs: [...state.tabs, newTab],
				activeTabIndex: state.tabs.length,
			};
		}
		case "close": {
			const { index } = action;
			if (index < 0 || index >= state.tabs.length) return state;
			const next = state.tabs.filter((_, i) => i !== index);
			if (next.length === 0) {
				return { tabs: [], activeTabIndex: 0 };
			}
			let activeTabIndex = state.activeTabIndex;
			if (index < state.activeTabIndex) activeTabIndex = state.activeTabIndex - 1;
			else if (index === state.activeTabIndex) {
				activeTabIndex = Math.min(state.activeTabIndex, next.length - 1);
			}
			return { tabs: next, activeTabIndex };
		}
		case "closeAll":
			return { tabs: [], activeTabIndex: 0 };
		case "select": {
			if (action.index < 0 || action.index >= state.tabs.length) return state;
			if (action.index === state.activeTabIndex) return state;
			return { ...state, activeTabIndex: action.index };
		}
		case "status": {
			const { index, status } = action;
			if (index < 0 || index >= state.tabs.length) return state;
			const tab = state.tabs[index]!;
			if (tab.status === status) return state;
			const next = [...state.tabs];
			next[index] = { ...tab, status };
			return { ...state, tabs: next };
		}
		default:
			return state;
	}
}

export function SshTerminalProvider({ children }: { children: ReactNode }) {
	const [state, dispatch] = useReducer(terminalReducer, {
		tabs: [] as SshTerminalTab[],
		activeTabIndex: 0,
	});

	const openTerminal = useCallback((server: {
		serverId: string;
		serverName: string;
		host: string;
		sessionToken: string;
	}) => {
		dispatch({ type: "open", server });
	}, []);

	const closeTab = useCallback((index: number) => {
		dispatch({ type: "close", index });
	}, []);

	const closeAll = useCallback(() => {
		dispatch({ type: "closeAll" });
	}, []);

	const handleStatusChange = useCallback((index: number, status: TerminalStatus) => {
		dispatch({ type: "status", index, status });
	}, []);

	const value = useMemo<SshTerminalContextValue>(
		() => ({ openTerminal, isOpen: state.tabs.length > 0 }),
		[openTerminal, state.tabs.length],
	);

	return (
		<SshTerminalContext.Provider value={value}>
			{children}
			{state.tabs.length > 0 && (
				<SshTerminalManager
					tabs={state.tabs}
					activeTabIndex={Math.min(state.activeTabIndex, state.tabs.length - 1)}
					onTabSelect={(index) => dispatch({ type: "select", index })}
					onTabClose={closeTab}
					onClose={closeAll}
					onStatusChange={handleStatusChange}
				/>
			)}
		</SshTerminalContext.Provider>
	);
}
