import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { PageGuide } from "../page-guide";

describe("PageGuide", () => {
	it("renders a collapsed disclosure with summary, numbered steps, and action links", () => {
		const { container } = render(
			<PageGuide
				title="How sync works"
				summary="Choose source and target servers before starting."
				steps={["Select a server", "Pick two folders", "Run once or schedule"]}
				links={[
					{ href: "/servers", label: "Servers" },
					{ href: "/files", label: "Files" },
				]}
			/>,
		);

		const details = container.querySelector("details");
		expect(details).not.toBeNull();
		expect(details).not.toHaveAttribute("open");
		expect(screen.getByText("How sync works")).toBeInTheDocument();
		expect(screen.getByText("Choose source and target servers before starting.")).toBeInTheDocument();
		expect(screen.getByText("Select a server")).toBeInTheDocument();
		expect(screen.getByText("Pick two folders")).toBeInTheDocument();
		expect(screen.getByRole("link", { name: "Servers" })).toHaveAttribute("href", "/servers");
		expect(screen.getByRole("link", { name: "Files" })).toHaveAttribute("href", "/files");
	});

	it("opens initially when defaultOpen is true", () => {
		const { container } = render(
			<PageGuide
				title="Quick start"
				steps={["Create a token"]}
				defaultOpen
			/>,
		);

		expect(container.querySelector("details")).toHaveAttribute("open");
	});
});
