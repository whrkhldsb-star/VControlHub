import { expect, it, vi } from "vitest";
import { createSingleFlight } from "../single-flight";

it("retains in-flight keys under pressure and admits a new key after completion", async () => {
  const flight = createSingleFlight<number>({ ttlMs: 1000, maxKeys: 1 });
  const pending = Promise.withResolvers<number>();
  const sample = vi.fn(() => pending.promise);
  const first = flight.run("a", sample);
  await expect(flight.run("b", sample)).rejects.toMatchObject({ status: 429 });
  const repeat = flight.run("a", sample);
  pending.resolve(1);
  expect(await Promise.all([first, repeat])).toEqual([1, 1]);
  expect(sample).toHaveBeenCalledOnce();
  await expect(flight.run("b", async () => 2)).resolves.toBe(2);
  await expect(flight.run("a", async () => 3)).resolves.toBe(3);
});
