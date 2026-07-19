/**
 * Test helpers for mocking Prisma client methods under vitest + tsc.
 *
 * Prisma's generated types return `PrismaPromise<T>` (thenable + query helpers),
 * not a plain `Promise<T>`. A bare `mockImplementation(async () => ...)` fails
 * `tsc --noEmit` (CI typecheck) even when the runtime behaviour is correct.
 *
 * Pass Prisma methods as `method as never` (or use the helpers from a `vi.fn()`).
 */

// Accept any object that has mockImplementation — Prisma client methods and
// vitest Mock instances both qualify at runtime; type via structural cast.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Mockable = { mockImplementation: (fn: (...args: any[]) => any) => unknown };

/**
 * Assign a mock implementation that is typecheck-safe against PrismaPromise.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function mockPrismaMethod(method: Mockable, impl: (...args: any[]) => any): void {
	method.mockImplementation(impl);
}

/**
 * Convenience for findFirst-style lookups: return `hit` when `where.id` is a
 * string, otherwise `miss` (default null). Covers the common "load by id, then
 * collision probe with `{ not: id }`" pattern.
 */
export function mockPrismaFindFirstById(
	method: Mockable,
	hit: unknown,
	miss: unknown = null,
): void {
	method.mockImplementation(async (args?: { where?: { id?: unknown } }) => {
		const id = args?.where?.id;
		if (typeof id === "string") return hit;
		return miss;
	});
}
