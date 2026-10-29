"use client";

import { useEffect, useRef, useState, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent } from "react";

import { chipActive, chipBase, chipIdle } from "@/components/ssh-terminal-chrome";
import { cn } from "@/lib/ui/cn";
import type { Modifier, ModifierStates } from "@/lib/rdp/sticky-modifiers";

type TFn = (key: string, vars?: Record<string, string | number>) => string;

/** Keysyms of the keys a phone's keyboard lacks. */
const KEY = {
  esc: 0xff1b, tab: 0xff09, left: 0xff51, up: 0xff52, right: 0xff53, down: 0xff54,
  home: 0xff50, end: 0xff57, pageUp: 0xff55, pageDown: 0xff56, insert: 0xff63, delete: 0xffff,
  f1: 0xffbe, win: 0xffeb,
} as const;

type PlainKey = { id: string; label: string; aria?: string; keysym: number; repeat?: boolean };

const MAIN_KEYS: readonly PlainKey[] = [
  { id: "esc", label: "Esc", keysym: KEY.esc },
  { id: "tab", label: "Tab", keysym: KEY.tab },
];
const NAVIGATION_KEYS: readonly PlainKey[] = [
  { id: "up", label: "↑", aria: "rdp.keys.up", keysym: KEY.up, repeat: true },
  { id: "down", label: "↓", aria: "rdp.keys.down", keysym: KEY.down, repeat: true },
  { id: "left", label: "←", aria: "rdp.keys.left", keysym: KEY.left, repeat: true },
  { id: "right", label: "→", aria: "rdp.keys.right", keysym: KEY.right, repeat: true },
  { id: "home", label: "Home", keysym: KEY.home },
  { id: "end", label: "End", keysym: KEY.end },
  { id: "pgup", label: "PgUp", keysym: KEY.pageUp, repeat: true },
  { id: "pgdn", label: "PgDn", keysym: KEY.pageDown, repeat: true },
  { id: "del", label: "Del", keysym: KEY.delete, repeat: true },
];
const FUNCTION_KEYS: readonly PlainKey[] = [
  ...Array.from({ length: 12 }, (_, index) => ({ id: `f${index + 1}`, label: `F${index + 1}`, keysym: KEY.f1 + index })),
  { id: "ins", label: "Ins", keysym: KEY.insert },
];

/** A held key repeats like a physical keyboard's: after a pause, at a steady rate (the remote side does not repeat for us). */
const REPEAT_DELAY_MS = 420;
const REPEAT_INTERVAL_MS = 45;
/** Holding the Win button this long arms it as a modifier instead of opening the Start menu. */
const WIN_HOLD_MS = 380;

export type RdpExtraKeysProps = {
  t: TFn;
  modifiers: ModifierStates;
  onModifier(modifier: Modifier): void;
  onKeyDown(keysym: number): void;
  onKeyRepeat(keysym: number): void;
  onKeyUp(keysym: number): void;
  /** The Start menu: Win pressed and released on its own. */
  onStart(): void;
  onHideKeyboard(): void;
};

/**
 * The row of keys above the on-screen keyboard, which the keyboard of a phone does
 * not have and Windows needs: Esc, Tab, Ctrl, Alt, Shift, Win, the arrows, Home,
 * End, the page keys, Delete and F1–F12, as in Microsoft's Remote Desktop app. The
 * modifiers are sticky: tap once for the next key, twice to hold.
 *
 * The buttons never take the focus from the keyboard's text field (that would
 * lower the keyboard on every tap): pressing is handled on pointer down.
 */
export function RdpExtraKeys({ t, modifiers, onModifier, onKeyDown, onKeyRepeat, onKeyUp, onStart, onHideKeyboard }: RdpExtraKeysProps) {
  const [page, setPage] = useState<"keys" | "function">("keys");
  const timers = useRef(new Map<string, { delay?: ReturnType<typeof setTimeout>; interval?: ReturnType<typeof setInterval> }>());
  const winHold = useRef<{ timer: ReturnType<typeof setTimeout>; armed: boolean } | null>(null);

  useEffect(() => () => {
    for (const timer of timers.current.values()) { clearTimeout(timer.delay); clearInterval(timer.interval); }
    timers.current.clear();
    if (winHold.current) clearTimeout(winHold.current.timer);
  }, []);

  const keepFocus = (event: ReactPointerEvent | ReactMouseEvent) => event.preventDefault();
  const dropWinHold = () => {
    if (winHold.current) clearTimeout(winHold.current.timer);
    winHold.current = null;
  };

  const pressKey = (key: PlainKey) => (event: ReactPointerEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    onKeyDown(key.keysym);
    if (!key.repeat) return;
    const entry: { delay?: ReturnType<typeof setTimeout>; interval?: ReturnType<typeof setInterval> } = {};
    entry.delay = setTimeout(() => {
      entry.interval = setInterval(() => onKeyRepeat(key.keysym), REPEAT_INTERVAL_MS);
    }, REPEAT_DELAY_MS);
    timers.current.set(key.id, entry);
  };
  const releaseKey = (key: PlainKey) => () => {
    const entry = timers.current.get(key.id);
    if (entry) { clearTimeout(entry.delay); clearInterval(entry.interval); timers.current.delete(key.id); }
    onKeyUp(key.keysym);
  };

  const plain = (key: PlainKey) => (
    <button
      key={key.id}
      type="button"
      onMouseDown={keepFocus}
      data-testid={`rdp-key-${key.id}`}
      aria-label={key.aria ? t(key.aria) : key.label}
      onPointerDown={pressKey(key)}
      onPointerUp={releaseKey(key)}
      onPointerCancel={releaseKey(key)}
      className={cn(chipBase, chipIdle, "min-w-10 shrink-0 select-none px-2 touch-manipulation")}
    >
      {key.label}
    </button>
  );

  const modifier = (name: Modifier, label: string) => (
    <button
      key={name}
      type="button"
      onMouseDown={keepFocus}
      data-testid={`rdp-key-${name}`}
      aria-pressed={modifiers[name] !== "off"}
      data-state={modifiers[name]}
      title={t("rdp.keys.stickyHint")}
      onPointerDown={keepFocus}
      onClick={() => onModifier(name)}
      className={cn(
        chipBase, "min-w-10 shrink-0 select-none px-2 touch-manipulation",
        modifiers[name] === "off" ? chipIdle : chipActive,
        modifiers[name] === "locked" && "font-semibold underline decoration-2 underline-offset-4",
      )}
    >
      {label}
    </button>
  );

  // Win on its own is the Start menu; held a moment it is a modifier for Win+R, Win+E and the like.
  const winKey = (
    <button
      key="win"
      type="button"
      onMouseDown={keepFocus}
      data-testid="rdp-key-win"
      aria-pressed={modifiers.win !== "off"}
      data-state={modifiers.win}
      aria-label={t("rdp.keys.win")}
      title={t("rdp.keys.winHint")}
      onPointerDown={event => {
        event.preventDefault();
        const hold = { armed: false, timer: setTimeout(() => { hold.armed = true; onModifier("win"); }, WIN_HOLD_MS) };
        winHold.current = hold;
      }}
      onPointerUp={() => {
        const hold = winHold.current;
        winHold.current = null;
        if (!hold) return;
        clearTimeout(hold.timer);
        if (hold.armed) return;
        // A tap on an armed or locked Win ends it; otherwise it opens the Start menu.
        if (modifiers.win !== "off") onModifier("win");
        else onStart();
      }}
      onPointerCancel={dropWinHold}
      onPointerLeave={dropWinHold}
      className={cn(chipBase, "min-w-10 shrink-0 select-none px-2 touch-manipulation", modifiers.win === "off" ? chipIdle : chipActive, modifiers.win === "locked" && "font-semibold underline decoration-2 underline-offset-4")}
    >
      Win
    </button>
  );

  return (
    <div
      data-testid="rdp-extra-keys"
      role="toolbar"
      aria-label={t("rdp.keys.label")}
      // A long press on a key (it repeats) is not a request for the browser's menu.
      onContextMenu={event => event.preventDefault()}
      className="flex items-center gap-1.5 overflow-x-auto border-t border-[var(--border-subtle)] px-2 py-1.5 light:border-[var(--border)]"
    >
      {page === "keys" ? (
        <>
          {MAIN_KEYS.map(plain)}
          {modifier("ctrl", "Ctrl")}
          {modifier("alt", "Alt")}
          {modifier("shift", "Shift")}
          {winKey}
          {NAVIGATION_KEYS.map(plain)}
        </>
      ) : (
        <>
          {modifier("ctrl", "Ctrl")}
          {modifier("alt", "Alt")}
          {modifier("shift", "Shift")}
          {FUNCTION_KEYS.map(plain)}
        </>
      )}
      <button
        type="button"
        onMouseDown={keepFocus}
        data-testid="rdp-key-page"
        aria-pressed={page === "function"}
        onPointerDown={keepFocus}
        onClick={() => setPage(value => (value === "keys" ? "function" : "keys"))}
        className={cn(chipBase, "min-w-10 shrink-0 select-none px-2 touch-manipulation", page === "function" ? chipActive : chipIdle)}
      >
        Fn
      </button>
      <button
        type="button"
        onMouseDown={keepFocus}
        data-testid="rdp-key-hide"
        aria-label={t("rdp.keys.hide")}
        onPointerDown={keepFocus}
        onClick={onHideKeyboard}
        className={cn(chipBase, chipIdle, "ml-auto min-w-10 shrink-0 select-none px-2 touch-manipulation")}
      >
        ⌄
      </button>
    </div>
  );
}
