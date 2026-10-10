import type { Prisma } from "@prisma/client";

type JsonPrimitive = string | number | boolean | null;

/**
 * Structural JSON check: plain objects, arrays and primitives (undefined
 * properties are dropped on serialization). Dates, bigints, functions and
 * class instances with methods resolve to `never`.
 */
export type JsonCompatible<T> = T extends JsonPrimitive | undefined
	? T
	: T extends Date | bigint | symbol | ((...args: never[]) => unknown)
		? never
		: T extends readonly (infer U)[]
			? readonly JsonCompatible<U>[]
			: T extends object
				? { [K in keyof T]: JsonCompatible<T[K]> }
				: never;

/**
 * Store a typed value in a Prisma Json column. Interfaces with optional
 * fields are not assignable to InputJsonValue, which used to force
 * `as unknown as` casts that also let non-JSON values through unchecked.
 */
export function toJsonValue<T>(value: T & JsonCompatible<T>): Prisma.InputJsonValue {
	return value as Prisma.InputJsonValue;
}
