// @vitest-environment jsdom
import { useState } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { NumberInput } from "../ui/number-input";

/**
 * Number fields were bound straight to numeric state: `onChange={(e) => setValue(Number(e.target.value) || 30)}`.
 * Selecting the "30" of the escalation delay and deleting it to type "45" put 30 back at once; where there
 * was no fallback the field showed 0. The field keeps what is typed and reports numbers.
 */
function Harness({ initial = 30, onReport, ...props }: { initial?: number; onReport?: (value: number) => void } & Partial<React.ComponentProps<typeof NumberInput>>) {
	const [value, setValue] = useState(initial);
	return (
		<>
			<NumberInput aria-label="minutes" value={value} onValueChange={(next) => { setValue(next); onReport?.(next); }} {...props} />
			<output data-testid="value">{value}</output>
			<button type="button" onClick={() => setValue(5)}>reset</button>
		</>
	);
}

const field = () => screen.getByLabelText("minutes") as HTMLInputElement;
const value = () => screen.getByTestId("value").textContent;

describe("NumberInput", () => {
	it("stays empty when it is cleared, and takes the number typed next", () => {
		const onReport = vi.fn();
		render(<Harness min={1} max={10080} onReport={onReport} />);
		expect(field().value).toBe("30");

		fireEvent.focus(field());
		fireEvent.change(field(), { target: { value: "" } });
		expect(field().value).toBe("");
		// Nothing was reported for the empty field: the value in effect is still the last number.
		expect(onReport).not.toHaveBeenCalled();
		expect(value()).toBe("30");

		fireEvent.change(field(), { target: { value: "4" } });
		fireEvent.change(field(), { target: { value: "45" } });
		expect(field().value).toBe("45");
		expect(value()).toBe("45");
	});

	it("shows the value in effect again when it is left empty", () => {
		render(<Harness min={1} />);
		fireEvent.focus(field());
		fireEvent.change(field(), { target: { value: "" } });
		expect(field()).toHaveAttribute("aria-invalid", "true");
		fireEvent.blur(field());
		expect(field().value).toBe("30");
		expect(field()).not.toHaveAttribute("aria-invalid");
	});

	it("reports a number inside the range while the text is as typed, and shows that number on leaving", () => {
		render(<Harness initial={80} min={1} max={100} />);
		fireEvent.focus(field());
		fireEvent.change(field(), { target: { value: "250" } });
		expect(field().value).toBe("250");
		expect(field()).toHaveAttribute("aria-invalid", "true");
		expect(value()).toBe("100");
		fireEvent.blur(field());
		expect(field().value).toBe("100");

		fireEvent.focus(field());
		fireEvent.change(field(), { target: { value: "0" } });
		expect(value()).toBe("1");
		fireEvent.blur(field());
		expect(field().value).toBe("1");
	});

	it("shows what will be submitted when Enter is pressed in a field that holds no number", () => {
		render(<Harness />);
		fireEvent.focus(field());
		fireEvent.change(field(), { target: { value: "" } });
		fireEvent.keyDown(field(), { key: "Enter" });
		expect(field().value).toBe("30");
	});

	it("rounds a fraction where only whole numbers make sense", () => {
		render(<Harness integer min={0} />);
		fireEvent.focus(field());
		fireEvent.change(field(), { target: { value: "2.6" } });
		expect(value()).toBe("3");
		fireEvent.blur(field());
		expect(field().value).toBe("3");
	});

	it("keeps a fraction otherwise", () => {
		render(<Harness initial={85} min={0} max={100} />);
		fireEvent.focus(field());
		fireEvent.change(field(), { target: { value: "92.5" } });
		expect(value()).toBe("92.5");
		expect(field()).not.toHaveAttribute("aria-invalid");
	});

	it("follows a value set from outside", () => {
		render(<Harness />);
		fireEvent.click(screen.getByRole("button", { name: "reset" }));
		expect(field().value).toBe("5");
	});

	it("is a number field with the shared field look, and passes the range on to the browser", () => {
		render(<Harness min={1} max={60} className="w-32" />);
		expect(field()).toHaveAttribute("type", "number");
		expect(field()).toHaveAttribute("min", "1");
		expect(field()).toHaveAttribute("max", "60");
		expect(field().className).toContain("ui-control");
		expect(field().className).toContain("w-32");
	});
});
