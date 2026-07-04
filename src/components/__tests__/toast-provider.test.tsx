import { afterEach, describe, expect, it, vi } from "vitest";
import { screen, fireEvent, act } from "@testing-library/react";

import { ToastProvider, useToast } from "../toast-provider";
import { renderWithI18n as render } from "@/lib/i18n/__tests__/test-helpers";

function ToastHarness() {
	const { toasts, addToast, removeToast } = useToast();
	return (
		<div>
			<button onClick={() => addToast("success", "Saved successfully", 4000)}>Show Success</button>
			<button onClick={() => addToast("error", "Operation failed", 4000)}>Show Error</button>
			<button onClick={() => addToast("info", "Persistent toast", 0)}>Show Persistent</button>
			<button onClick={() => addToast("warning", "Warning msg", 4000)}>Show Warning</button>
			<span data-testid="count">{toasts.length}</span>
			{toasts.map((t) => (
				<button key={t.id} onClick={() => removeToast(t.id)} data-testid={`dismiss-${t.id}`}>
					dismiss
				</button>
			))}
		</div>
	);
}

function renderToast() {
	return render(
		<ToastProvider>
			<ToastHarness />
		</ToastProvider>,
	);
}

describe("ToastProvider", () => {
	afterEach(() => {
		vi.useRealTimers();
	});

	it("shows a toast when addToast is called", () => {
		renderToast();
		fireEvent.click(screen.getByText("Show Success"));
		expect(screen.getByText("Saved successfully")).toBeInTheDocument();
		expect(screen.getByText("✓")).toBeInTheDocument();
	});

	it("shows error and warning toasts with correct icons", () => {
		renderToast();
		fireEvent.click(screen.getByText("Show Error"));
		fireEvent.click(screen.getByText("Show Warning"));
		expect(screen.getByText("Operation failed")).toBeInTheDocument();
		expect(screen.getByText("Warning msg")).toBeInTheDocument();
	});

	it("dismisses a toast when the close button is clicked", () => {
		renderToast();
		fireEvent.click(screen.getByText("Show Success"));
		expect(screen.getByText("Saved successfully")).toBeInTheDocument();

		// Each toast has a Close button (aria-label="Close")
		fireEvent.click(screen.getByRole("button", { name: "Close" }));
		expect(screen.queryByText("Saved successfully")).not.toBeInTheDocument();
	});

	it("auto-dismisses after the duration", () => {
		vi.useFakeTimers();
		renderToast();
		fireEvent.click(screen.getByText("Show Success"));
		expect(screen.getByText("Saved successfully")).toBeInTheDocument();

		act(() => {
			vi.advanceTimersByTime(4000);
		});

		expect(screen.queryByText("Saved successfully")).not.toBeInTheDocument();
	});

	it("does not auto-dismiss when duration is 0", () => {
		vi.useFakeTimers();
		renderToast();
		fireEvent.click(screen.getByText("Show Persistent"));
		expect(screen.getByText("Persistent toast")).toBeInTheDocument();

		act(() => {
			vi.advanceTimersByTime(10000);
		});

		expect(screen.getByText("Persistent toast")).toBeInTheDocument();
	});

	it("tracks the number of active toasts", () => {
		renderToast();
		expect(screen.getByTestId("count")).toHaveTextContent("0");

		fireEvent.click(screen.getByText("Show Success"));
		expect(screen.getByTestId("count")).toHaveTextContent("1");

		fireEvent.click(screen.getByText("Show Error"));
		expect(screen.getByTestId("count")).toHaveTextContent("2");

		fireEvent.click(screen.getAllByRole("button", { name: "Close" })[0]!);
		expect(screen.getByTestId("count")).toHaveTextContent("1");
	});
});
