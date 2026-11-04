import { describe, expect, it } from "vitest";

import { normalizeTicketPriority, ticketPriorityInputSchema } from "./priority";

describe("ticket priority spellings", () => {
  it("stores every accepted spelling as one of the four product levels", () => {
    for (const spelling of ticketPriorityInputSchema.options) {
      expect(["LOW", "NORMAL", "HIGH", "URGENT"]).toContain(normalizeTicketPriority(spelling));
    }
  });

  it("maps MEDIUM to NORMAL and critical to URGENT, so the detail route agrees with the collection route", () => {
    expect(normalizeTicketPriority("MEDIUM")).toBe("NORMAL");
    expect(normalizeTicketPriority("normal")).toBe("NORMAL");
    expect(normalizeTicketPriority("critical")).toBe("URGENT");
    expect(normalizeTicketPriority(undefined)).toBeUndefined();
  });
});
