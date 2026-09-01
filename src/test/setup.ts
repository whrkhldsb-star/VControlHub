import "@testing-library/jest-dom/vitest";
import { afterEach, vi } from "vitest";

// Vitest reuses worker threads across test files. A fake clock left behind by
// one file makes user-event and bcrypt await timers that never advance in the
// next file, producing order-dependent timeouts. Tests that opt into fake
// timers must not leak that global state across test boundaries.
// Same reasoning for `vi.stubGlobal`. A file that stubs `fetch` (or `File`,
// `crypto`, …) and never restores it leaves that stub installed for whichever
// unrelated file the worker picks up next, which shows up as a failure in a file
// that passes in isolation — order-dependent and painful to trace. 13 test files
// stub a global; restoring centrally is more reliable than remembering in each.
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
