"use client";

import { useEffect, useRef, type PointerEvent as ReactPointerEvent } from "react";

/** How far the knob travels from the middle, in pixels. */
const RADIUS = 24;
/** The view's speed with the knob at its limit, in pixels per second. */
const MAX_SPEED = 700;
/** The knob must leave the middle by this much before the view moves. */
const DEAD_ZONE = 0.12;

export type RdpPanControlProps = {
  label: string;
  /** Called every frame while held with how far the content should move, in pixels (it follows the opposite direction of the knob). */
  onPan(dx: number, dy: number): void;
};

/**
 * The pan control of Microsoft's Remote Desktop app: a knob to hold and push in the
 * direction the screen should move, for a picture that is zoomed in or half hidden
 * by the on-screen keyboard. The further the knob is pushed, the faster the view
 * moves; letting go springs it back to the middle.
 */
export function RdpPanControl({ label, onPan }: RdpPanControlProps) {
  const knob = useRef<HTMLDivElement>(null);
  const loop = useRef<{ frame: number; last: number; x: number; y: number } | null>(null);
  const onPanRef = useRef(onPan);
  useEffect(() => { onPanRef.current = onPan; }, [onPan]);

  useEffect(() => () => {
    if (loop.current) cancelAnimationFrame(loop.current.frame);
    loop.current = null;
  }, []);

  const place = (x: number, y: number) => {
    if (knob.current) knob.current.style.transform = `translate(${x}px, ${y}px)`;
  };

  const tick = (now: number) => {
    const state = loop.current;
    if (!state) return;
    const dt = Math.min(0.05, (now - state.last) / 1000);
    state.last = now;
    const fx = Math.hypot(state.x, state.y) / RADIUS > DEAD_ZONE ? state.x / RADIUS : 0;
    const fy = Math.hypot(state.x, state.y) / RADIUS > DEAD_ZONE ? state.y / RADIUS : 0;
    if (fx || fy) onPanRef.current(-fx * MAX_SPEED * dt, -fy * MAX_SPEED * dt);
    state.frame = requestAnimationFrame(tick);
  };

  const stop = () => {
    if (loop.current) cancelAnimationFrame(loop.current.frame);
    loop.current = null;
    place(0, 0);
  };

  const move = (event: ReactPointerEvent<HTMLDivElement>) => {
    const state = loop.current;
    if (!state) return;
    const box = event.currentTarget.getBoundingClientRect();
    let x = event.clientX - (box.left + box.width / 2), y = event.clientY - (box.top + box.height / 2);
    const length = Math.hypot(x, y);
    if (length > RADIUS) { x = (x / length) * RADIUS; y = (y / length) * RADIUS; }
    state.x = x;
    state.y = y;
    place(x, y);
  };

  return (
    <div
      data-testid="rdp-pan-control"
      role="button"
      tabIndex={-1}
      aria-label={label}
      title={label}
      className="absolute bottom-4 right-4 z-10 flex h-[76px] w-[76px] touch-none select-none items-center justify-center rounded-full border border-[var(--border-subtle)] bg-[var(--surface-elevated)]/70 shadow-lg backdrop-blur-sm light:border-[var(--border)]"
      onPointerDown={event => {
        event.preventDefault();
        event.stopPropagation();
        event.currentTarget.setPointerCapture?.(event.pointerId);
        loop.current = { frame: requestAnimationFrame(tick), last: performance.now(), x: 0, y: 0 };
        move(event);
      }}
      onPointerMove={move}
      onPointerUp={stop}
      onPointerCancel={stop}
    >
      <div
        ref={knob}
        aria-hidden="true"
        className="pointer-events-none h-9 w-9 rounded-full border border-[var(--color-action-border)] bg-[var(--color-action-bg)] shadow"
      />
    </div>
  );
}
