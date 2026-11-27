import { Prisma } from "@prisma/client";

/**
 * UTC timestamp SQL fragments for PostgreSQL `TIMESTAMP(3)` (without time zone)
 * columns, which Prisma always stores in UTC.
 *
 * A bare `NOW()` or `clock_timestamp()` casts to `timestamp without time zone`
 * using the database session's `TimeZone` setting, causing hours of skew on
 * non-UTC PostgreSQL sessions. Use these fragments consistently whenever a
 * lease, deadline, or fencing comparison runs on the database clock.
 */
export const DB_UTC_NOW = Prisma.sql`(NOW() AT TIME ZONE 'UTC')`;

/** Statement/wall-clock UTC timestamp inside long-running transactions. */
export const DB_UTC_CLOCK_NOW = Prisma.sql`(clock_timestamp() AT TIME ZONE 'UTC')`;
