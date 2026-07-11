import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { PageShell, PageHeader, EmptyState, StatCard } from "../page-shell";

describe("PageShell Components", () => {
	describe("PageShell", () => {
		it("renders children", () => {
			render(
				<PageShell>
					<div data-testid="child-content">Child</div>
				</PageShell>
			);
			expect(screen.getByTestId("child-content")).toBeInTheDocument();
		});
	});

	describe("PageHeader", () => {
		it("renders title, eyebrow, and description", () => {
			render(
				<PageHeader 
					eyebrow="Eyebrow Text" 
					title="Test Title" 
					description="Test Description" 
				/>
			);
			expect(screen.getByText("Test Title")).toBeInTheDocument();
			expect(screen.getByText("Eyebrow Text")).toBeInTheDocument();
			expect(screen.getByText("Test Description")).toBeInTheDocument();
		});

		it("renders children action area", () => {
			render(
				<PageHeader eyebrow="Actions" title="Title">
					<button>Click Me</button>
				</PageHeader>
			);
			expect(screen.getByRole("button", { name: "Click Me" })).toBeInTheDocument();
		});
	});

	describe("EmptyState", () => {
		it("renders simple text", () => {
			render(<EmptyState text="Nothing here" />);
			expect(screen.getByText("Nothing here")).toBeInTheDocument();
		});

		it("renders boxed variant with text", () => {
			render(<EmptyState text="Boxed empty" variant="boxed" />);
			expect(screen.getByText("Boxed empty")).toBeInTheDocument();
		});
	});

	describe("StatCard", () => {
		it("renders label, value, and detail", () => {
			render(<StatCard label="Total Users" value={100} detail="Active" />);
			expect(screen.getByText("Total Users")).toBeInTheDocument();
			expect(screen.getByText("100")).toBeInTheDocument();
			expect(screen.getByText("Active")).toBeInTheDocument();
		});
	});
});
