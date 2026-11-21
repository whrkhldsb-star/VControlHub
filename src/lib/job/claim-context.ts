import { AsyncLocalStorage } from "node:async_hooks";

type Claim = { id: string; workerId: string; attempts: number };
const workerClaim = new AsyncLocalStorage<{ claim?: Claim }>();

// Existing workers immediately await claimNextJob and run their timers and
// lifecycle callbacks in that continuation. Allocate a fresh binding before
// the first await so a later poll cannot mutate the previous poll's claim.
// Callers handing a job across async contexts pass its attempts explicitly.
export function beginJobClaim() {
  const binding: { claim?: Claim } = {};
  workerClaim.enterWith(binding);
  return binding;
}

function jobClaimAttempts(id: string, workerId: string, attempts?: number) {
  if (attempts !== undefined) return attempts;
  const bound = workerClaim.getStore()?.claim;
  if (bound?.id === id && bound.workerId === workerId && Number.isInteger(bound.attempts)) return bound.attempts;
  // A legacy scheduler creates RUNNING ticks directly (attempt zero). After
  // even one queue claim, a callback needs the original binding or its token.
  return 0;
}

export function activeJobClaim(id: string, workerId: string, attempts?: number) {
  return { id, status: "RUNNING" as const, workerId, attempts: jobClaimAttempts(id, workerId, attempts) };
}
