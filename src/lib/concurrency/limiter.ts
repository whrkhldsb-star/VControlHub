/**
 * A limiter that lets at most `max` of the functions given to it run at once; the rest wait their turn in order.
 * `collectAllHealth` started a TCP probe and an SSH collection for every server at the same moment, so a fleet of a few
 * hundred servers opened that many sockets and key exchanges in one burst (the sibling paths cap at 5).
 */
export function createLimiter(max: number): <T>(task: () => Promise<T>) => Promise<T> {
  const limit = Math.max(1, Math.floor(max));
  let active = 0;
  const waiting: Array<() => void> = [];
  const release = () => {
    active -= 1;
    waiting.shift()?.();
  };
  return async <T>(task: () => Promise<T>): Promise<T> => {
    if (active >= limit) await new Promise<void>((resolve) => waiting.push(resolve));
    active += 1;
    try {
      return await task();
    } finally {
      release();
    }
  };
}
