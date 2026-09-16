"use client";

import { useMemo, useState } from "react";

import { UI_INPUT } from "@/lib/ui/classes";
import { ActionButton } from "@/components/action-button";
import {
	BUILDER_KEYS,
	buildQuickKeyPreset,
	type KeyModifier,
	type QuickKeyPreset,
} from "@/components/ssh-quick-keys";

const MODIFIERS: ReadonlyArray<{ id: KeyModifier; label: string }> = [
	{ id: "ctrl", label: "Ctrl" },
	{ id: "shift", label: "Shift" },
	{ id: "alt", label: "Alt" },
];

type TFn = (key: string, vars?: Record<string, string | number>) => string;

/**
 * Inline builder for user-defined quick-key presets: toggle modifiers,
 * pick a key, preview the sequence, then add it to the persistent list.
 * Renders inside the side panel below the quick-keys grid.
 */
export function QuickKeyBuilder({
	t,
	onAdd,
}: {
	t: TFn;
	onAdd: (preset: QuickKeyPreset) => void;
}) {
	const [open, setOpen] = useState(false);
	const [modifiers, setModifiers] = useState<KeyModifier[]>([]);
	const [keyId, setKeyId] = useState<string>("c");

	const preset = useMemo(() => {
		try {
			return buildQuickKeyPreset({ keyId, modifiers });
		} catch {
			return null;
		}
	}, [keyId, modifiers]);

	const toggleModifier = (id: KeyModifier) => {
		setModifiers((prev) => (prev.includes(id) ? prev.filter((m) => m !== id) : [...prev, id]));
	};

	const add = () => {
		if (!preset) return;
		onAdd(preset);
		// Keep the builder ready for the next combination but reset the key.
		setKeyId("c");
	};

	if (!open) {
		return (
			<ActionButton variant="ghost" onClick={() => setOpen(true)} className="mt-1 !min-h-9 !w-full !justify-center !rounded-lg !text-[12px] text-[var(--text-muted)]">
				+ {t("sshTerminalModal.quickKeysCustomize")}
			</ActionButton>
		);
	}

	return (
		<div className="mt-2 rounded-lg border border-[var(--border-subtle)] light:border-[var(--border)] p-2">
			<div className="mb-1 flex items-center justify-between">
				<span className="text-[11px] font-medium text-[var(--text-muted)]/70 light:text-[var(--text-primary)]/70">
					{t("sshTerminalModal.quickKeysCustomize")}
				</span>
				<button
					type="button"
					onClick={() => setOpen(false)}
					className="rounded px-1 text-[11px] text-[var(--text-muted)]/60 hover:text-[var(--text-muted)]"
					aria-label={t("sshTerminalModal.quickKeysClose")}
				>
					✕
				</button>
			</div>
			<div className="mb-1 grid grid-cols-3 gap-1">
				{MODIFIERS.map((mod) => {
					const active = modifiers.includes(mod.id);
					return (
						<button
							type="button"
							key={mod.id}
							onClick={() => toggleModifier(mod.id)}
							aria-pressed={active}
							className={`${UI_INPUT} !min-h-8 !rounded-md !px-1 !py-0 !text-[12px] ${active ? "!border-[var(--color-action)] !text-[var(--color-action)]" : "text-[var(--text-muted)]"}`}
						>
							{mod.label}
						</button>
					);
				})}
			</div>
			<select
				value={keyId}
				onChange={(event) => setKeyId(event.target.value)}
				className={`${UI_INPUT} mb-1 !min-h-8 !rounded-md !px-1 !py-0 !text-[12px]`}
				aria-label={t("sshTerminalModal.quickKeysPickKey")}
			>
				{BUILDER_KEYS.map((k) => (
					<option key={k.id} value={k.id}>
						{k.label}
					</option>
				))}
			</select>
			<div className="flex items-center gap-1">
				<span className="flex-1 truncate rounded bg-[var(--surface)] px-2 py-1 text-center font-mono text-[12px] text-[var(--text-primary)] light:text-[var(--text-primary)]" data-testid="quick-key-preview">
					{preset ? preset.label : "—"}
				</span>
				<ActionButton
					variant="primary"
					onClick={add}
					disabled={!preset}
					className="!min-h-8 !rounded-md !px-2 !py-0 !text-[12px]"
				>
					{t("sshTerminalModal.quickKeysAdd")}
				</ActionButton>
			</div>
		</div>
	);
}
