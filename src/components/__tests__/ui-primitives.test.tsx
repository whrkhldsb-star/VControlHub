import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Badge, Card, Spinner, ProgressBar } from "../ui-primitives";

describe("UI Primitives", () => {
	describe("Badge", () => {
		it("renders with default props", () => {
			render(<Badge>Default Badge</Badge>);
			const badge = screen.getByText("Default Badge");
			expect(badge).toBeInTheDocument();
			expect(badge.className).toContain("rounded-full");
		});

		it("applies tone correctly", () => {
			render(<Badge tone="emerald">Success</Badge>);
			expect(screen.getByText("Success")).toHaveAttribute("data-tone", "emerald");
		});
	});

	describe("Card", () => {
		it("renders children inside", () => {
			render(<Card>Card Content</Card>);
			expect(screen.getByText("Card Content")).toBeInTheDocument();
		});
	});

	describe("Spinner", () => {
		it("renders with correct size and default accessible label", () => {
			render(<Spinner size="lg" />);
			const status = screen.getByRole("status");
			expect(status).toBeInTheDocument();
			expect(status).toHaveAttribute("aria-label", "Loading…");
		});

		it("accepts localized label for i18n call sites", () => {
			render(<Spinner label="加载中…" />);
			expect(screen.getByRole("status")).toHaveAttribute("aria-label", "加载中…");
		});
	});

	describe("ProgressBar", () => {
		it("renders correctly", () => {
			render(<ProgressBar value={50} />);
			expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "50");
		});
	});
});
