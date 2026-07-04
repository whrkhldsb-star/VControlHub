import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ThemeToggle } from "../theme-toggle";
import { useTheme } from "@/lib/theme/use-theme";

vi.mock("@/lib/theme/use-theme", () => ({
	useTheme: vi.fn(),
}));

describe("ThemeToggle", () => {
	it("renders correctly and toggles theme", () => {
		const toggleThemeMock = vi.fn();
		(useTheme as any).mockReturnValue({ theme: "light", toggleTheme: toggleThemeMock });

		render(<ThemeToggle />);
		const btn = screen.getByRole("button");
		expect(btn).toBeInTheDocument();
		fireEvent.click(btn);
		expect(toggleThemeMock).toHaveBeenCalled();
	});
});
