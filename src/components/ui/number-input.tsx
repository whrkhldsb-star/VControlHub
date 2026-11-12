"use client";

import { useState, type InputHTMLAttributes } from "react";

import { UI_INPUT } from "@/lib/ui/classes";
import { cn } from "@/lib/ui/cn";

/**
 * NumberInput — a number field bound to a number.
 *
 *   <NumberInput id="cooldown" value={cooldown} onValueChange={setCooldown} min={1} integer />
 *
 * An `<input type="number">` bound straight to numeric state cannot be emptied: clearing it to type another
 * value is read as 0 (or as the fallback of `Number(text) || 30`) and the field fills itself in again. Here
 * the text being typed is the field's own. Every text that is a number is reported, brought into
 * `min`…`max` (and rounded with `integer`); a text that is not one reports nothing, so the value in effect
 * stays the last number. On leaving the field, or on Enter, the field shows the value in effect — what a
 * submit will send is what is on screen.
 *
 * Forms that keep the text themselves (`useState("")`, parsed on submit) do not need this.
 */
export type NumberInputProps = Omit<InputHTMLAttributes<HTMLInputElement>, "type" | "value" | "defaultValue" | "onChange" | "min" | "max"> & {
	value: number;
	onValueChange: (value: number) => void;
	min?: number;
	max?: number;
	/** Whole numbers only: a typed fraction is rounded. */
	integer?: boolean;
};

function toValue(text: string, { min, max, integer }: Pick<NumberInputProps, "min" | "max" | "integer">): number | null {
	if (text.trim() === "") return null;
	let value = Number(text);
	if (!Number.isFinite(value)) return null;
	if (integer) value = Math.round(value);
	if (min !== undefined && value < min) value = min;
	if (max !== undefined && value > max) value = max;
	return value;
}

export function NumberInput({ value, onValueChange, min, max, integer, className, onBlur, onKeyDown, ...rest }: NumberInputProps) {
	// What is being typed, while it is being typed; null shows the value in effect.
	const [draft, setDraft] = useState<string | null>(null);
	const range = { min, max, integer };
	const typed = draft === null ? null : toValue(draft, range);
	// Marked while the text is not the number in effect: empty, not a number, or outside the range.
	const invalid = draft !== null && (typed === null || typed !== Number(draft));

	return (
		<input
			{...rest}
			type="number"
			inputMode={integer ? "numeric" : "decimal"}
			min={min}
			max={max}
			step={rest.step ?? (integer ? 1 : "any")}
			value={draft ?? String(value)}
			aria-invalid={invalid ? true : rest["aria-invalid"]}
			data-input
			data-error={invalid ? "true" : undefined}
			className={cn(UI_INPUT, className)}
			onChange={(event) => {
				const text = event.target.value;
				setDraft(text);
				const next = toValue(text, range);
				if (next !== null && next !== value) onValueChange(next);
			}}
			onBlur={(event) => {
				setDraft(null);
				onBlur?.(event);
			}}
			onKeyDown={(event) => {
				if (event.key === "Enter") setDraft(null);
				onKeyDown?.(event);
			}}
		/>
	);
}
