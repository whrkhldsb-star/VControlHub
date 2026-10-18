"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

import { useSshTerminal } from "@/app/servers/ssh-terminal-context";

/**
 * The remote desktop lives in the session workbench now, beside SSH
 * terminals. This old address (bookmarks, links) opens it there and
 * returns to the server list, which the workbench floats over.
 */
export function OpenRemoteDesktop({ serverId, serverName, host }: { serverId: string; serverName: string; host: string }) {
  const { openRemoteDesktop } = useSshTerminal();
  const router = useRouter();
  useEffect(() => {
    openRemoteDesktop({ serverId, serverName, host });
    router.replace("/servers");
  }, [openRemoteDesktop, router, serverId, serverName, host]);
  return null;
}
