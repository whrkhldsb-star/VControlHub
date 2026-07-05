"use client";

type TFunction = (key: string) => string;

type SshTerminalSidePanelProps = {
  commandHistory: string[];
  favoriteCommands: string[];
  newFavorite: string;
  onAddFavorite: () => void;
  onRemoveFavorite: (cmd: string) => void;
  onSendCommand: (cmd: string) => void;
  serverId: string;
  setNewFavorite: (value: string) => void;
  t: TFunction;
};

const QUICK_COMMANDS = ["ls -la", "df -h", "free -m", "top -bn1 | head -20", "uptime", "whoami", "cat /etc/os-release", "ps aux --sort=-%mem | head -10"];

export function SshTerminalSidePanel({
  commandHistory,
  favoriteCommands,
  newFavorite,
  onAddFavorite,
  onRemoveFavorite,
  onSendCommand,
  serverId,
  setNewFavorite,
  t,
}: SshTerminalSidePanelProps) {
  return (
    <div className="flex max-h-[50vh] w-full shrink-0 flex-col gap-3 overflow-y-auto lg:ml-3 lg:max-h-none lg:w-64">
      <section className="rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-subtle)] p-3">
        <h4 className="mb-2 text-xs font-medium text-[var(--text-secondary)]">{t("sshTerminalModal.favoritesTitle")}</h4>
        <div className="mb-2 flex gap-1.5">
          <label htmlFor={`ssh-favorite-command-${serverId}`} className="sr-only">
            {t("sshTerminalModal.favoritesLabel")}
          </label>
          <input
            id={`ssh-favorite-command-${serverId}`}
            value={newFavorite}
            onChange={(e) => setNewFavorite(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && onAddFavorite()}
            placeholder={t("sshTerminalModal.favoritesPlaceholder")}
            className="min-h-11 min-w-0 flex-1 rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-elevated)] px-3 py-1 text-[13px] font-mono text-[var(--text-primary)] outline-none placeholder:text-[var(--text-muted)] focus:border-[var(--color-action-border)]/30"
          />
          <button onClick={onAddFavorite} aria-label={t("sshTerminalModal.favoritesAdd")} data-tone="cyan" className="min-h-11 min-w-11 shrink-0 rounded-lg border border-[var(--color-action-border)]/20 px-2 py-1 text-[13px] text-[var(--color-action-fg)] transition hover:bg-[var(--color-action-bg)]/20">
            +
          </button>
        </div>
        {favoriteCommands.length === 0 ? (
          <p className="text-[10px] text-[var(--text-muted)]">{t("sshTerminalModal.favoritesEmpty")}</p>
        ) : (
          <div className="space-y-1">
            {favoriteCommands.map((cmd) => (
              <div key={cmd} className="group flex items-center gap-1">
                <button onClick={() => onSendCommand(cmd)} className="min-h-11 min-w-0 flex-1 truncate rounded-lg px-3 py-1 text-left text-[12px] font-mono text-[var(--color-action-fg)]/80 transition hover:bg-[var(--surface-hover)]" title={cmd}>
                  {cmd}
                </button>
                <button onClick={() => onRemoveFavorite(cmd)} aria-label={t("sshTerminalModal.favoritesRemove").replace("{cmd}", cmd)} className="min-h-11 min-w-11 shrink-0 rounded-lg px-1 text-[12px] text-[var(--danger)]/70 transition hover:bg-[var(--danger-bg)] hover:text-[var(--danger)] group-hover:opacity-100">
                  ✕
                </button>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-subtle)] p-3">
        <h4 className="mb-2 text-xs font-medium text-[var(--text-secondary)]">{t("sshTerminalModal.historyTitle")}</h4>
        {commandHistory.length === 0 ? (
          <p className="text-[10px] text-[var(--text-muted)]">{t("sshTerminalModal.historyEmpty")}</p>
        ) : (
          <div className="max-h-[300px] space-y-1 overflow-y-auto">
            {commandHistory.map((cmd, i) => (
              <button key={`${cmd}-${i}`} onClick={() => onSendCommand(cmd)} className="min-h-11 block w-full truncate rounded-lg px-3 py-1 text-left text-[12px] font-mono text-[var(--text-secondary)] transition hover:bg-[var(--surface-hover)] hover:text-[var(--color-action-fg)]/80" title={cmd}>
                {cmd}
              </button>
            ))}
          </div>
        )}
      </section>

      <section className="rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-subtle)] p-3">
        <h4 className="mb-2 text-xs font-medium text-[var(--text-secondary)]">{t("sshTerminalModal.quickCommandsTitle")}</h4>
        <div className="space-y-1">
          {QUICK_COMMANDS.map((cmd) => (
            <button key={cmd} onClick={() => onSendCommand(cmd)} className="min-h-11 block w-full truncate rounded-lg px-3 py-1 text-left text-[12px] font-mono text-[var(--text-muted)] transition hover:bg-[var(--surface-hover)] hover:text-[var(--color-action-fg)]/80" title={cmd}>
              {cmd}
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}
