import { useState } from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AnchoredMenu, MenuItem, type MenuAnchor } from "../ui/menu";

function setViewport(width: number, height: number) {
	Object.defineProperty(window, "innerWidth", { configurable: true, value: width });
	Object.defineProperty(window, "innerHeight", { configurable: true, value: height });
}

function mockPanelSize(width: number, height: number) {
	return vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
		if (this.getAttribute("role") === "menu") return { width, height, top: 0, left: 0, right: width, bottom: height, x: 0, y: 0, toJSON: () => ({}) } as DOMRect;
		if (this.dataset.anchor === "button") return { width: 32, height: 32, top: 100, left: 300, right: 332, bottom: 132, x: 300, y: 100, toJSON: () => ({}) } as DOMRect;
		return { width: 0, height: 0, top: 0, left: 0, right: 0, bottom: 0, x: 0, y: 0, toJSON: () => ({}) } as DOMRect;
	});
}

function Harness({ anchor: initial, onSelect = vi.fn() }: { anchor: MenuAnchor | null; onSelect?: () => void }) {
	const [anchor, setAnchor] = useState<MenuAnchor | null>(initial);
	return (
		<>
			<p>outside</p>
			<AnchoredMenu anchor={anchor} label="Actions" onClose={() => setAnchor(null)}>
				<MenuItem onSelect={onSelect}>Rename</MenuItem>
				<MenuItem onSelect={() => undefined}>Delete</MenuItem>
			</AnchoredMenu>
		</>
	);
}

describe("AnchoredMenu", () => {
	afterEach(() => vi.restoreAllMocks());

	it("opens at the pointer, in a body portal, with the first item focused", () => {
		setViewport(1000, 800);
		mockPanelSize(180, 120);
		const { container } = render(<Harness anchor={{ x: 120, y: 200 }} />);
		const menu = screen.getByRole("menu", { name: "Actions" });
		expect(container.contains(menu)).toBe(false);
		expect(menu.style.position).toBe("fixed");
		expect(menu.style.left).toBe("120px");
		expect(menu.style.top).toBe("204px");
		expect(document.activeElement).toBe(screen.getByRole("menuitem", { name: "Rename" }));
	});

	it("flips above and inside the viewport near the bottom-right corner", () => {
		setViewport(400, 300);
		mockPanelSize(180, 120);
		render(<Harness anchor={{ x: 390, y: 290 }} />);
		const menu = screen.getByRole("menu");
		expect(menu.style.top).toBe(`${290 - 4 - 120}px`);
		expect(menu.style.left).toBe(`${400 - 8 - 180}px`);
	});

	it("lines a button's menu up with the button's right edge", () => {
		setViewport(1000, 800);
		mockPanelSize(180, 120);
		const button = document.createElement("button");
		button.dataset.anchor = "button";
		document.body.append(button);
		render(<Harness anchor={button} />);
		const menu = screen.getByRole("menu");
		expect(menu.style.left).toBe(`${332 - 180}px`);
		expect(menu.style.top).toBe("136px");
		button.remove();
	});

	it("moves with the arrow keys and closes on Escape, a choice or an outside press", () => {
		setViewport(1000, 800);
		mockPanelSize(180, 120);
		const onSelect = vi.fn();
		const first = render(<Harness anchor={{ x: 10, y: 10 }} onSelect={onSelect} />);
		fireEvent.keyDown(screen.getByRole("menu"), { key: "ArrowDown" });
		expect(document.activeElement).toBe(screen.getByRole("menuitem", { name: "Delete" }));
		fireEvent.keyDown(screen.getByRole("menu"), { key: "ArrowDown" });
		expect(document.activeElement).toBe(screen.getByRole("menuitem", { name: "Rename" }));
		fireEvent.keyDown(document, { key: "Escape" });
		expect(screen.queryByRole("menu")).not.toBeInTheDocument();
		first.unmount();

		const second = render(<Harness anchor={{ x: 10, y: 10 }} onSelect={onSelect} />);
		fireEvent.click(screen.getByRole("menuitem", { name: "Rename" }));
		expect(onSelect).toHaveBeenCalledOnce();
		expect(screen.queryByRole("menu")).not.toBeInTheDocument();
		second.unmount();

		render(<Harness anchor={{ x: 10, y: 10 }} />);
		fireEvent.pointerDown(screen.getByText("outside"));
		expect(screen.queryByRole("menu")).not.toBeInTheDocument();
	});

	it("closes when the page scrolls", () => {
		setViewport(1000, 800);
		mockPanelSize(180, 120);
		render(<Harness anchor={{ x: 10, y: 10 }} />);
		act(() => {
			window.dispatchEvent(new Event("scroll"));
		});
		expect(screen.queryByRole("menu")).not.toBeInTheDocument();
	});
});
