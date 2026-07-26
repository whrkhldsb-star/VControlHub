"use client";

import { UI_INPUT } from "@/lib/ui/classes";
import { cn } from "@/lib/ui/cn";
import { ActionButton } from "@/components/action-button";

const QUICK_COMMANDS = ["ls -la","df -h","free -m","top -bn1 | head -20","uptime","whoami","cat /etc/os-release","ps aux --sort=-%mem | head -10",
] as const;

type TFn = (key: string, vars?: Record<string, string | number>) => string;

export function SshTerminalSidePanel({
	serverId,
	t,
	favoriteCommands,
	newFavorite,
	setNewFavorite,
	addFavorite,
	removeFavorite,
	commandHistory,
	sendCommand,
}: {
	serverId: string;
	t: TFn;
	favoriteCommands: string[];
	newFavorite: string;
	setNewFavorite: (value: string) => void;
	addFavorite: () => void;
	removeFavorite: (cmd: string) => void;
	commandHistory: string[];
	sendCommand: (cmd: string) => void;
}) {
	return (
		<div className="flex max-h-[50vh] w-full shrink-0 flex-col gap-3 overflow-y-auto lg:ml-3 lg:max-h-none lg:w-56">
			<section className="rounded-xl border border-[var(--border-subtle)] light:border-[var(--border)] bg-[var(--surface-subtle)] light:bg-[var(--surface)] p-3">
				<h4 className="mb-2 text-xs font-medium text-[var(--text-muted)]/60 light:text-[var(--text-primary)]/60">
					{t("sshTerminalModal.favoritesTitle")}
				</h4>
				<div className="mb-2 flex gap-1.5">
					<label htmlFor={`ssh-fav-${serverId}`} className="sr-only">
						{t("sshTerminalModal.favoritesLabel")}
					</label>
					<input
						id={`ssh-fav-${serverId}`}
						value={newFavorite}
						onChange={(e) => setNewFavorite(e.target.value)}
						onKeyDown={(e) => e.key ==="Enter" && addFavorite()}
						placeholder={t("sshTerminalModal.favoritesPlaceholder")}
						className={cn(
							UI_INPUT,"min-h-11 min-w-0 flex-1 py-1 font-mono text-[13px] placeholder:text-[var(--text-muted)]/20",
						)}
					/>
					<ActionButton variant="outline"
						onClick={addFavorite}
						aria-label={t("sshTerminalModal.favoritesAdd")}
						data-tone="cyan" className="min-h-11 min-w-11 shrink-0 !px-2 !py-1 !text-[13px]"
					>
						+
					</ActionButton>
				</div>
				{favoriteCommands.length === 0 ? (
					<p className="text-[10px] text-[var(--text-muted)]">
						{t("sshTerminalModal.favoritesEmpty")}
					</p>
				) : (
					<div className="space-y-1">
						{favoriteCommands.map((cmd) => (
							<div key={cmd} className="group flex items-center gap-1">
								<ActionButton variant="ghost"
									onClick={() => sendCommand(cmd)} className="!min-h-11 !min-w-0 !flex-1 !truncate !rounded-lg !px-3 !py-1 !text-left !text-[12px] !font-mono"
									title={cmd}
								>
									{cmd}
								</ActionButton>
								<ActionButton variant="ghost"
									onClick={() => removeFavorite(cmd)}
									aria-label={t("sshTerminalModal.favoritesRemove", { cmd })} className="!min-h-11 !min-w-11 !shrink-0 !rounded-lg !px-1 !text-[12px] text-[var(--danger)] group-hover:opacity-100"
								>
									✕
								</ActionButton>
							</div>
						))}
					</div>
				)}
			</section>
			<section className="rounded-xl border border-[var(--border-subtle)] light:border-[var(--border)] bg-[var(--surface-subtle)] light:bg-[var(--surface)] p-3">
				<h4 className="mb-2 text-xs font-medium text-[var(--text-muted)]/60 light:text-[var(--text-primary)]/60">
					{t("sshTerminalModal.historyTitle")}
				</h4>
				{commandHistory.length === 0 ? (
					<p className="text-[10px] text-[var(--text-muted)]">
						{t("sshTerminalModal.historyEmpty")}
					</p>
				) : (
					<div className="max-h-[200px] space-y-1 overflow-y-auto">
						{commandHistory.map((cmd, i) => (
							<ActionButton variant="ghost"
								key={`${cmd}-${i}`}
								onClick={() => sendCommand(cmd)} className="!min-h-11 !block !w-full !truncate !rounded-lg !px-3 !py-1 !text-left !text-[12px] !font-mono"
								title={cmd}
							>
								{cmd}
							</ActionButton>
						))}
					</div>
				)}
			</section>
			<section className="rounded-xl border border-[var(--border-subtle)] light:border-[var(--border)] bg-[var(--surface-subtle)] light:bg-[var(--surface)] p-3">
				<h4 className="mb-2 text-xs font-medium text-[var(--text-muted)]/60 light:text-[var(--text-primary)]/60">
					{t("sshTerminalModal.quickCommandsTitle")}
				</h4>
				<div className="space-y-1">
					{QUICK_COMMANDS.map((cmd) => (
						<ActionButton variant="ghost"
							key={cmd}
							onClick={() => sendCommand(cmd)} className="!min-h-11 !block !w-full !truncate !rounded-lg !px-3 !py-1 !text-left !text-[12px] !font-mono text-[var(--text-muted)]"
							title={cmd}
						>
							{cmd}
						</ActionButton>
					))}
				</div>
			</section>
		</div>
	);
}
