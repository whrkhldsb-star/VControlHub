import "@testing-library/jest-dom/vitest";
import { afterEach, vi } from "vitest";

// Vitest reuses worker threads across test files. A fake clock left behind by
// one file makes user-event and bcrypt await timers that never advance in the
// next file, producing order-dependent timeouts. Tests that opt into fake
// timers must not leak that global state across test boundaries.
afterEach(() => {
  vi.useRealTimers();
});
