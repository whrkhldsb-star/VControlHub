import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ModalShell } from "@/components/modal-shell";

describe("ModalShell", () => {
	it("portals overlays to document.body instead of a transformed page ancestor", async () => {
		const onClose = vi.fn();
		const { container } = render(
			<article style={{ transform: "translateY(-1px)" }}>
				<ModalShell open onClose={onClose} labelledBy="portal-title">
					<h2 id="portal-title">Stable dialog</h2>
				</ModalShell>
			</article>,
		);

		const dialog = await screen.findByRole("dialog", { name: "Stable dialog" });
		expect(container.querySelector('[role="dialog"]')).toBeNull();
		expect(dialog.parentElement).toBe(document.body.querySelector("[data-modal-overlay]"));
		expect(dialog.closest("article")).toBeNull();

		fireEvent.click(dialog.parentElement!);
		expect(onClose).toHaveBeenCalledOnce();
	});
});
