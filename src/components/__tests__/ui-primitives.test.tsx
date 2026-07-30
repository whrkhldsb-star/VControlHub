import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  Badge,
  CheckboxField,
  FormField,
  FormGrid,
  IconButton,
  Notice,
  ProgressBar,
  Spinner,
} from "../ui-primitives";

describe("UI Primitives", () => {
  it("renders badges, spinners and progress", () => {
    render(<><Badge tone="emerald">Success</Badge><Spinner label="加载中…" /><ProgressBar value={50} /></>);
    expect(screen.getByText("Success")).toHaveAttribute("data-tone", "emerald");
    expect(screen.getByRole("status")).toHaveAttribute("aria-label", "加载中…");
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "50");
  });

  it("renders an accessible notice with action and dismiss controls", () => {
    const retry = vi.fn();
    const dismiss = vi.fn();
    render(<Notice tone="danger" title="Load failed" action={{ label: "Retry", onClick: retry }} dismissLabel="Dismiss" onDismiss={dismiss}>Server unavailable</Notice>);
    const alert = screen.getByRole("alert");
    expect(alert).toHaveAttribute("data-notice-tone", "danger");
    expect(alert).toHaveTextContent("Load failed");
    expect(alert).toHaveTextContent("Server unavailable");
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(retry).toHaveBeenCalledOnce();
    expect(dismiss).toHaveBeenCalledOnce();
  });

  it("uses status semantics for non-error notices", () => {
    render(<Notice tone="success">Saved</Notice>);
    expect(screen.getByRole("status")).toHaveTextContent("Saved");
  });

  it("associates form field hint and error content with its control", () => {
    const { rerender } = render(<FormField label="Name" htmlFor="name" hint="Public label"><input id="name" /></FormField>);
    expect(screen.getByLabelText("Name")).toBeInTheDocument();
    expect(screen.getByText("Public label")).toHaveAttribute("id", "name-hint");
    rerender(<FormField label="Name" htmlFor="name" error="Required"><input id="name" /></FormField>);
    expect(screen.getByRole("alert")).toHaveAttribute("id", "name-error");
  });

  it("renders form grids and checkbox fields with consistent semantics", () => {
    render(<FormGrid columns={2}><CheckboxField name="enabled" label="Enabled" hint="Applies immediately" /></FormGrid>);
    expect(screen.getByLabelText("Enabled")).toHaveAttribute("name", "enabled");
    expect(screen.getByText("Applies immediately")).toBeVisible();
  });

  it("provides an accessible icon-only action", () => {
    const onClick = vi.fn();
    render(<IconButton label="Delete" tone="danger" onClick={onClick}>×</IconButton>);
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(onClick).toHaveBeenCalledOnce();
  });
});
