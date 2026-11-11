import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

// A zone that is neither the default nor, in all likelihood, the machine's.
vi.mock("@/lib/datetime/time-zone", async (importOriginal) => ({
	...(await importOriginal<typeof import("@/lib/datetime/time-zone")>()),
	APP_TIME_ZONE: "America/New_York",
}));

import { LiveClock, OsMark, UsageMeter } from "../board-visuals";

describe("board visuals", () => {
	it("shows the clock in the zone the board's charts and dates are in, and names it", () => {
		// The clock ran in the visitor's own zone and everything else on the board in the application's, with
		// neither named: from another zone, "current time" and the end of the 24-hour chart were hours apart.
		render(<LiveClock locale="en" initialMs={Date.UTC(2026, 0, 1, 16, 30, 5)} />);
		expect(screen.getByText("11:30:05")).toBeInTheDocument();
		expect(screen.getByText(/01\/01\/2026/)).toHaveTextContent("GMT-5");
	});

	it("leaves a bar without a label to the number written next to it", () => {
		// In the table and the detail tiles the percentage is text beside the bar; the bar was a second, unnamed
		// meter for assistive technology.
		const { container, rerender } = render(<UsageMeter label="" value={42} />);
		expect(screen.queryByRole("meter")).toBeNull();
		expect(container.querySelector("[data-usage-meter] [aria-hidden='true']")).not.toBeNull();

		rerender(<UsageMeter label="CPU" value={42} />);
		expect(screen.getByRole("meter", { name: "CPU" })).toHaveAttribute("aria-valuenow", "42");
	});

	it("does not take an architecture for a distribution", () => {
		const mark = (os: string) => render(<OsMark os={os} />).container.firstElementChild as HTMLElement;
		// "aarch64" contains "arch": such a system was drawn with Arch Linux's mark and colour.
		expect(mark("Oracle Linux Server 9.3 aarch64").textContent).toBe("O");
		expect(mark("Arch Linux").textContent).toBe("A");
		expect(mark("archlinux").style.background).toBe(mark("Arch Linux").style.background);
		expect(mark("Oracle Linux Server 9.3 aarch64").style.background).not.toBe(mark("Arch Linux").style.background);
	});
});
