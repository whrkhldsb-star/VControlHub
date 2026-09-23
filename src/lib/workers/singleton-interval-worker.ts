/**
 * Shared boilerplate for "singleton interval worker" modules (TR: one factory, ~20 former copies).
 *
 * Every background worker in this repo used to carry a verbatim copy of the same
 * three-part skeleton:
 *   1. a globalThis-keyed singleton state (`__vcontrolhubXxxWorker ??= { started,
 *      running, timer }`) that survives Next.js dev-mode module reloads,
 *   2. a `startX()` that flips `started`, fires a startup tick, installs
 *      `setInterval` and `unref()`s the timer so tests can exit,
 *   3. a `stopXForTests()` that clears the timer and resets all three fields.
 *
 * They drifted only in interval source (env const, config getter, options
 * override, async runtime setting) and in the tick body. This factory keeps the
 * globalThis key per worker (so dev-reload semantics are unchanged) and leaves
 * interval resolution + tick body in the caller. When the resolved interval is
 * a plain number the whole start runs synchronously — exactly like the former
 * inline code — so two racing starts still cannot install two intervals. An
 * async resolver is awaited BEFORE `started` latches, so a settings/DB failure
 * cannot permanently disable the worker (started=true with timer=null).
 *
 * Importers keep their public surface: `export async function startX()` wraps
 * `worker.start()` and `export function stopXForTests()` wraps
 * `worker.stopForTests()`, so existing call sites and tests do not change.
 * `onStarted` fires only when this call actually started the worker, so the
 * per-worker "started" log keeps its former once-only semantics.
 */

export type SingletonIntervalWorkerState = {
  started: boolean;
  running: boolean;
  timer: NodeJS.Timeout | null;
};

export type SingletonIntervalWorkerTickReason = "startup" | "interval";

export type SingletonIntervalWorkerTick = (
  state: SingletonIntervalWorkerState,
  reason: SingletonIntervalWorkerTickReason,
) => void;

export type SingletonIntervalWorkerStartResult = {
  state: SingletonIntervalWorkerState;
  /** True when a previous start had already started this worker (no-op call). */
  alreadyStarted: boolean;
};

export type SingletonIntervalWorker = {
  getState(): SingletonIntervalWorkerState;
  start(options?: { intervalMs?: number }): Promise<SingletonIntervalWorkerStartResult>;
  stopForTests(): void;
};

type SingletonWorkerGlobal = typeof globalThis & {
  [globalKey: string]: SingletonIntervalWorkerState | undefined;
};

/**
 * Get (lazily creating) the per-worker singleton state stored under
 * `globalKey` on globalThis. The key must be worker-unique and stable
 * (e.g. `__vcontrolhubTicketSlaWorker`).
 */
export function getSingletonIntervalWorkerState(globalKey: string): SingletonIntervalWorkerState {
  const globalState = globalThis as SingletonWorkerGlobal;
  globalState[globalKey] ??= { started: false, running: false, timer: null };
  return globalState[globalKey]!;
}

/**
 * Clear the singleton worker's timer and reset its state. The test-side
 * counterpart of `start()`; safe to call before `start()` or multiple times.
 */
export function stopSingletonIntervalWorkerForTests(globalKey: string): SingletonIntervalWorkerState {
  const state = getSingletonIntervalWorkerState(globalKey);
  if (state.timer) {
    clearInterval(state.timer);
  }
  state.started = false;
  state.running = false;
  state.timer = null;
  return state;
}

/**
 * Build the start/stop/getState trio for one background worker.
 *
 * - `resolveIntervalMs` returns the tick interval in ms; it is only consulted
 *   when `start()` is not given an explicit `intervalMs`.
 * - `tick` receives the singleton state (for re-entrancy guards) and the
 *   reason ("startup" | "interval"); it must not throw synchronously.
 * - `onStarted` runs only on the call that transitions the worker to started
 *   (never on idempotent re-entry), with the effective interval.
 */
export function createSingletonIntervalWorker(config: {
  globalKey: string;
  resolveIntervalMs: () => number | Promise<number>;
  tick: SingletonIntervalWorkerTick;
  onStarted?: (state: SingletonIntervalWorkerState, intervalMs: number) => void;
}): SingletonIntervalWorker {
  const getState = () => getSingletonIntervalWorkerState(config.globalKey);
  return {
    getState,
    start(options) {
      const state = getState();
      if (state.started) return Promise.resolve({ state, alreadyStarted: true });

      const begin = (intervalMs: number) => {
        state.started = true;
        config.tick(state, "startup");
        state.timer = setInterval(() => {
          config.tick(state, "interval");
        }, intervalMs);
        state.timer.unref?.();
        config.onStarted?.(state, intervalMs);
        return state;
      };

      const resolved: number | Promise<number> = options?.intervalMs ?? config.resolveIntervalMs();
      if (typeof resolved === "number") {
        return Promise.resolve({ state: begin(resolved), alreadyStarted: false });
      }
      return resolved.then((intervalMs) => ({ state: begin(intervalMs), alreadyStarted: false }));
    },
    stopForTests() {
      stopSingletonIntervalWorkerForTests(config.globalKey);
    },
  };
}
