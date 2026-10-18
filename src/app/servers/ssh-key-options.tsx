"use client";

import { createContext, useContext, type ReactNode } from "react";

export type SshKeyOption = { id: string; name: string; fingerprint: string; description: string | null };

const SshKeyOptionsContext = createContext<SshKeyOption[]>([]);

/** The key library, loaded once by the page, for every node's edit form. */
export function SshKeyOptionsProvider({ sshKeys, children }: { sshKeys: SshKeyOption[]; children: ReactNode }) {
  return <SshKeyOptionsContext.Provider value={sshKeys}>{children}</SshKeyOptionsContext.Provider>;
}

export function useSshKeyOptions() {
  return useContext(SshKeyOptionsContext);
}
