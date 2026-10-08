"use client";

import { ActionButton, ButtonLink, type ButtonSize } from "@/components/action-button";
import { Server } from "@/components/icons";
import { useI18n } from "@/lib/i18n/use-locale";

type Props = {
  serverId: string;
  serverName: string;
  size: ButtonSize;
  block: boolean;
} & ({ protocol: "rdp" } | { protocol: "ssh"; onClick: () => void });

/** Same dimensions and icon treatment for both connection protocols. */
export function ServerConnectionAction(props: Props) {
  const { t } = useI18n();
  const look = {
    variant: "ghost" as const, size: props.size, block: props.block,
    "data-tone": "cyan", "data-server-connection": props.protocol,
    className: props.block ? undefined : "w-36",
    icon: <Server aria-hidden="true" />,
  };
  return props.protocol === "rdp"
    ? <ButtonLink {...look} href={`/servers/${encodeURIComponent(props.serverId)}/remote-desktop`}>
        {t("serversPage.windows.remoteDesktop")}
      </ButtonLink>
    : <ActionButton {...look} onClick={props.onClick} aria-label={t("serverCardActions.sshTerminalAria", { name: props.serverName })}>
        {t("serverCardActions.sshTerminalButton")}
      </ActionButton>;
}
