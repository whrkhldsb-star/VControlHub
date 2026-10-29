/**
 * Ctrl, Alt, Shift and Win for a keyboard that has no such keys: a phone's. They
 * work like the extra-key rows of Microsoft's Remote Desktop app and of terminal
 * apps: tapped once a modifier is armed and applies to the next key only (Ctrl,
 * then C, is Ctrl+C); tapped again it is locked and stays held, as for Alt+Tab
 * pressed several times; tapped a third time it is released.
 */
export type Modifier = "ctrl" | "alt" | "shift" | "win";
export type ModifierState = "off" | "armed" | "locked";
export type ModifierStates = Record<Modifier, ModifierState>;

export const MODIFIER_KEYSYM: Record<Modifier, number> = { ctrl: 0xffe3, alt: 0xffe9, shift: 0xffe1, win: 0xffeb };
export const MODIFIERS: readonly Modifier[] = ["ctrl", "alt", "shift", "win"];

/** What the remote keyboard must be told: a key (keysym) going down or up. */
export type KeyAction = { pressed: boolean; keysym: number };

export type StickyModifiers = {
  states(): ModifierStates;
  /** A tap on a modifier's button: off, armed, locked, off. Locking presses the key, unlocking releases it. */
  tap(modifier: Modifier): KeyAction[];
  /**
   * A key is about to be sent: the keys to press before it (armed modifiers) and
   * after it (the same ones, released). Locked modifiers are already held.
   */
  wrap(): { before: KeyAction[]; after: KeyAction[] };
  /** Releases everything (the session ended, or the keyboard closed). */
  reset(): KeyAction[];
};

export function createStickyModifiers(onChange: (states: ModifierStates) => void): StickyModifiers {
  let current: ModifierStates = { ctrl: "off", alt: "off", shift: "off", win: "off" };
  const set = (next: ModifierStates) => { current = next; onChange({ ...next }); };

  return {
    states: () => ({ ...current }),

    tap(modifier) {
      const keysym = MODIFIER_KEYSYM[modifier];
      const state = current[modifier];
      const next: ModifierState = state === "off" ? "armed" : state === "armed" ? "locked" : "off";
      set({ ...current, [modifier]: next });
      if (next === "locked") return [{ pressed: true, keysym }];
      if (state === "locked") return [{ pressed: false, keysym }];
      return [];
    },

    wrap() {
      const armed = MODIFIERS.filter(modifier => current[modifier] === "armed");
      if (armed.length === 0) return { before: [], after: [] };
      set({ ...current, ...Object.fromEntries(armed.map(modifier => [modifier, "off"])) });
      return {
        before: armed.map(modifier => ({ pressed: true, keysym: MODIFIER_KEYSYM[modifier] })),
        after: [...armed].reverse().map(modifier => ({ pressed: false, keysym: MODIFIER_KEYSYM[modifier] })),
      };
    },

    reset() {
      const held = MODIFIERS.filter(modifier => current[modifier] === "locked");
      set({ ctrl: "off", alt: "off", shift: "off", win: "off" });
      return held.map(modifier => ({ pressed: false, keysym: MODIFIER_KEYSYM[modifier] }));
    },
  };
}
