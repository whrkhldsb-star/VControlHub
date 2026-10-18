"use client";

import { ActionButton, ButtonLink, type ButtonSize } from "@/components/action-button";
import { Server } from "@/components/icons";
import { useI18n } from "@/lib/i18n/use-locale";
import { useOptionalSshTerminal } from "./ssh-terminal-context";

type Props = {
  serverId: string;
  serverName: string;
  size: ButtonSize;
  block: boolean;
} & ({ protocol: "rdp"; host: string } | { protocol: "ssh"; onClick: () => void });

/** Same dimensions and icon treatment for both connection protocols. */
export function ServerConnectionAction(props: Props) {
  const { t } = useI18n();
  const sessions = useOptionalSshTerminal();
  const look = {
    variant: "ghost" as const, size: props.size, block: props.block,
    "data-tone": "cyan", "data-server-connection": props.protocol,
    className: props.block ? undefined : "w-36",
    icon: <Server aria-hidden="true" />,
  };
  if (props.protocol === "ssh") {
    return <ActionButton {...look} onClick={props.onClick} aria-label={t("serverCardActions.sshTerminalAria", { name: props.serverName })}>
      {t("serverCardActions.sshTerminalButton")}
    </ActionButton>;
  }
  // The remote desktop opens in the same workbench as SSH terminals; the
  // page link is only for a tree without it.
  return sessions
    ? <ActionButton {...look} onClick={() => sessions.openRemoteDesktop({ serverId: props.serverId, serverName: props.serverName, host: props.host })}>
        {t("serversPage.windows.remoteDesktop")}
      </ActionButton>
    : <ButtonLink {...look} href={`/servers/${encodeURIComponent(props.serverId)}/remote-desktop`}>
        {t("serversPage.windows.remoteDesktop")}
      </ButtonLink>;
}
