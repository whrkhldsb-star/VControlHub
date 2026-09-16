/**
 * User-composable quick-key presets for the SSH terminal side panel.
 *
 * Mobile keyboards cannot type control sequences (Ctrl+C, Shift+Tab, …), so
 * the panel offers on-screen stand-ins. Beyond the fixed defaults users can
 * compose their own modifier+key combinations; presets persist in
 * localStorage next to the favorite commands.
 */

export type KeyModifier = "ctrl" | "shift" | "alt";

/** Keys a preset can be built from. `label` is what the builder shows. */
export const BUILDER_KEYS: ReadonlyArray<{ id: string; label: string }> = [
	...Array.from({ length: 26 }, (_, i) => {
		const letter = String.fromCharCode(97 + i); // a..z
		return { id: letter, label: letter.toUpperCase() };
	}),
	...Array.from({ length: 10 }, (_, i) => ({ id: String(i), label: String(i) })),
	{ id: "tab", label: "Tab" },
	{ id: "enter", label: "Enter" },
	{ id: "space", label: "Space" },
	{ id: "esc", label: "Esc" },
	{ id: "backspace", label: "Bksp" },
	{ id: "up", label: "↑" },
	{ id: "down", label: "↓" },
	{ id: "left", label: "←" },
	{ id: "right", label: "→" },
	{ id: "home", label: "Home" },
	{ id: "end", label: "End" },
	{ id: "pageup", label: "PgUp" },
	{ id: "pagedown", label: "PgDn" },
];

/** A user-defined preset: ordered modifier list + key id, e.g. shift+tab. */
export type QuickKeyPreset = {
	label: string;
	sequence: QuickKeySequence;
};

export type QuickKeySequence = {
	keyId: string;
	modifiers: KeyModifier[];
};

/** The fixed baseline shown before the user customizes anything. */
export const DEFAULT_QUICK_KEY_PRESETS: ReadonlyArray<{ label: string; data: string }> = [
	{ label: "Ctrl+C", data: "\u0003" },
	{ label: "Ctrl+D", data: "\u0004" },
	{ label: "Ctrl+Z", data: "\u001a" },
	{ label: "Tab", data: "\t" },
	{ label: "Ctrl+L", data: "\u000c" },
	{ label: "Ctrl+U", data: "\u0015" },
	{ label: "Ctrl+W", data: "\u0017" },
	{ label: "Esc", data: "\u001b" },
	{ label: "↑", data: "\u001b[A" },
	{ label: "↓", data: "\u001b[B" },
	{ label: "←", data: "\u001b[D" },
	{ label: "→", data: "\u001b[C" },
];

/** Control-code mapping for Ctrl+letter (Ctrl+A = 0x01 … Ctrl+Z = 0x1a). */
function ctrlCode(letter: string): string {
	return String.fromCharCode(letter.charCodeAt(0) - 96);
}

/** xterm modifyOtherKeys-style CSI for decorated special keys. */
function decoratedSpecialKeyId(keyId: string): { code: number; final: string } | null {
	switch (keyId) {
		case "up": return { code: 1, final: "A" };
		case "down": return { code: 1, final: "B" };
		case "right": return { code: 1, final: "C" };
		case "left": return { code: 1, final: "D" };
		case "home": return { code: 1, final: "H" };
		case "end": return { code: 1, final: "F" };
		case "pageup": return { code: 5, final: "~" };
		case "pagedown": return { code: 6, final: "~" };
		default: return null;
	}
}

function modifierParam(modifiers: KeyModifier[]): number {
	// 1=none 2=Shift 3=Alt 4=Shift+Alt 5=Ctrl 6=Shift+Ctrl 7=Alt+Ctrl 8=all
	let param = 1;
	if (modifiers.includes("shift")) param += 1;
	if (modifiers.includes("alt")) param += 2;
	if (modifiers.includes("ctrl")) param += 4;
	return param;
}

function modifierLabelPrefix(modifiers: KeyModifier[]): string {
	const order: KeyModifier[] = ["ctrl", "shift", "alt"];
	return order
		.filter((m) => modifiers.includes(m))
		.map((m) => (m === "ctrl" ? "Ctrl" : m === "shift" ? "Shift" : "Alt"))
		.map((m) => `${m}+`)
		.join("");
}

function keyDisplayLabel(keyId: string): string {
	const found = BUILDER_KEYS.find((k) => k.id === keyId);
	return found ? found.label : keyId;
}

/**
 * Encode a modifier+key combination into the raw byte sequence xterm
 * forwards to the PTY. Throws for key ids that are not composable.
 */
export function encodeQuickKeySequence(sequence: QuickKeySequence): string {
	const { keyId, modifiers } = sequence;
	const hasCtrl = modifiers.includes("ctrl");
	const hasAlt = modifiers.includes("alt");
	const hasShift = modifiers.includes("shift");

	const base = decoratedSpecialKeyId(keyId);
	if (base) {
		if (!hasCtrl && !hasAlt && !hasShift) {
			return `\u001b[${base.code === 1 ? "" : base.code}${base.final}`;
		}
		return `\u001b[${base.code};${modifierParam(modifiers)}${base.final}`;
	}

	switch (keyId) {
		case "tab":
			if (hasShift) return "\u001b[Z";
			if (hasCtrl) return "\u0009"; // Ctrl+Tab is not distinguishable in a PTY
			if (hasAlt) return "\u001b\t";
			return "\t";
		case "enter":
			if (hasAlt) return "\u001b\r";
			if (hasShift) return "\r";
			return "\r";
		case "space":
			if (hasCtrl) return "\u0000";
			if (hasAlt) return "\u001b ";
			return " ";
		case "esc":
			return "\u001b";
		case "backspace":
			if (hasAlt) return "\u001b\u007f";
			return hasCtrl ? "\u0008" : "\u007f";
		default: {
			// a-z / 0-9 — the only keys where Ctrl is meaningful.
			const isLetter = /^[a-z]$/.test(keyId);
			const isDigit = /^[0-9]$/.test(keyId);
			if (!isLetter && !isDigit) throw new Error(`Unsupported key id: ${keyId}`);
			if (hasCtrl && isLetter) {
				const code = ctrlCode(keyId);
				return hasAlt ? `\u001b${code}` : code;
			}
			if (hasCtrl && isDigit) {
				// Ctrl+digit has no standard control code; forward bare digit.
				return hasAlt ? `\u001b${keyId}` : keyId;
			}
			let char = isLetter && hasShift ? keyId.toUpperCase() : keyId;
			if (hasAlt) char = `\u001b${char}`;
			return char;
		}
	}
}

/** Human label for a preset, e.g. "Shift+Tab". */
export function quickKeyPresetLabel(sequence: QuickKeySequence): string {
	return `${modifierLabelPrefix(sequence.modifiers)}${keyDisplayLabel(sequence.keyId)}`;
}

export function buildQuickKeyPreset(sequence: QuickKeySequence): QuickKeyPreset {
	return { label: quickKeyPresetLabel(sequence), sequence };
}

/** Serialize presets for localStorage. */
export function serializeQuickKeyPresets(presets: QuickKeyPreset[]): string {
	return JSON.stringify(presets);
}

/** Parse stored presets; returns null when absent or malformed. */
export function parseQuickKeyPresets(raw: string | null): QuickKeyPreset[] | null {
	if (!raw) return null;
	try {
		const parsed: unknown = JSON.parse(raw);
		if (!Array.isArray(parsed)) return null;
		const presets: QuickKeyPreset[] = [];
		for (const item of parsed) {
			if (typeof item !== "object" || item === null) return null;
			const candidate = item as Partial<QuickKeyPreset>;
			if (typeof candidate.label !== "string") return null;
			const seq = candidate.sequence as Partial<QuickKeySequence> | undefined;
			if (!seq || typeof seq.keyId !== "string" || !Array.isArray(seq.modifiers)) return null;
			if (!seq.modifiers.every((m) => m === "ctrl" || m === "shift" || m === "alt")) return null;
			presets.push({ label: candidate.label, sequence: { keyId: seq.keyId, modifiers: seq.modifiers as KeyModifier[] } });
		}
		return presets;
	} catch {
		return null;
	}
}

/**
 * Render a parsed preset list to the entries the palette consumes. Invalid
 * combinations (encoder throws) are dropped instead of breaking the panel.
 */
export function quickKeyPresetsToEntries(
	presets: QuickKeyPreset[] | null,
): ReadonlyArray<{ label: string; data: string }> {
	if (!presets) return DEFAULT_QUICK_KEY_PRESETS;
	const entries: { label: string; data: string }[] = [];
	for (const preset of presets) {
		try {
			entries.push({ label: preset.label, data: encodeQuickKeySequence(preset.sequence) });
		} catch {
			// Skip presets that reference unknown keys (e.g. from an older build).
		}
	}
	return entries.length > 0 ? entries : DEFAULT_QUICK_KEY_PRESETS;
}
