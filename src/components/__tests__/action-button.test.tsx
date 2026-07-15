import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";

import { ActionButton } from "../action-button";

describe("ActionButton", () => {
	it("renders with data-action-button and default variant=primary", () => {
		render(<ActionButton>Save</ActionButton>);
		const btn = screen.getByRole("button", { name: "Save" });
		expect(btn.hasAttribute("data-action-button")).toBe(true);
		expect(btn.getAttribute("data-variant")).toBe("primary");
		expect(btn.getAttribute("type")).toBe("button");
	});

	it("honors variant=outline", () => {
		render(<ActionButton variant="outline">Cancel</ActionButton>);
		expect(screen.getByRole("button").getAttribute("data-variant")).toBe("outline");
	});

	it("honors variant=ghost", () => {
		render(<ActionButton variant="ghost">More</ActionButton>);
		expect(screen.getByRole("button").getAttribute("data-variant")).toBe("ghost");
	});

	it("honors semantic success/danger/secondary variants", () => {
		const { rerender } = render(<ActionButton variant="success">OK</ActionButton>);
		expect(screen.getByRole("button").getAttribute("data-variant")).toBe("success");
		rerender(<ActionButton variant="danger">Del</ActionButton>);
		expect(screen.getByRole("button").getAttribute("data-variant")).toBe("danger");
		rerender(<ActionButton variant="secondary">Skip</ActionButton>);
		expect(screen.getByRole("button").getAttribute("data-variant")).toBe("secondary");
	});

	it("passes through onClick, type=submit, and disabled", () => {
		let clicked = 0;
		render(
			<ActionButton type="submit" disabled onClick={() => clicked++}>
				Submit
			</ActionButton>,
		);
		const btn = screen.getByRole("button");
		expect(btn.getAttribute("type")).toBe("submit");
		expect((btn as HTMLButtonElement).disabled).toBe(true);
	});

	it("does not lose extra className when provided", () => {
		render(<ActionButton className="w-full">Full</ActionButton>);
		expect(screen.getByRole("button").className).toContain("w-full");
	});
});
