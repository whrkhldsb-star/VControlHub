/**
 * Keyboard helpers shared by Enter-handling inputs.
 *
 * Browsers signal an active IME composition (Chinese/Japanese/… input
 * methods) on the keydown that confirms a candidate: `isComposing` is set,
 * and legacy engines report `keyCode === 229` instead. Treat such events as
 * "text, not a command": an Enter that confirms a candidate must never send
 * a message, submit a search, or navigate a list.
 */
export function isImeComposition(event: {
	nativeEvent?: { isComposing?: boolean };
	keyCode?: number;
}): boolean {
	return event.nativeEvent?.isComposing === true || event.keyCode === 229;
}
