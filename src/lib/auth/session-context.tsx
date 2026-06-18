"use client";

import { createContext, useContext, type ReactNode } from "react";

import { EMPTY_GATE, type SessionGate } from "./session-gate";

/**
 * Client-side view of the authenticated session.
 *
 * Built by `gateFromRoles()` (server-friendly, in `./session-gate`) from a
 * server-verified `SessionPayload` and fed into `SessionGateProvider` here so
 * the client tree can read it via `useSessionGate()`. Defaults to an
 * unauthenticated empty gate when no provider is mounted so misuse (forgetting
 * the provider) yields a fail-safe "no permissions" rather than throwing —
 * keeping with task 56's "hide UI when no permission" contract (TR-030
 * multi-tenant via permission-gated render).
 */

const SessionGateContext = createContext<SessionGate>(EMPTY_GATE);

export function SessionGateProvider({
	value,
	children,
}: {
	value: SessionGate;
	children: ReactNode;
}) {
	return (
		<SessionGateContext.Provider value={value}>
			{children}
		</SessionGateContext.Provider>
	);
}

/**
 * Reads the current `SessionGate` from context. Returns an empty
 * (unauthenticated) gate when the provider is missing so callers can safely
 * use the returned values for conditional rendering without try/catch.
 */
export function useSessionGate(): SessionGate {
	return useContext(SessionGateContext) ?? EMPTY_GATE;
}

// Re-export the server-friendly primitives so existing client code that
// imports `SessionGate` / `EMPTY_GATE` / `gateFromRoles` from
// "./session-context" keeps working.
export { EMPTY_GATE, gateFromRoles, type SessionGate } from "./session-gate";
