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
  SegmentedTabs,
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
    expect(screen.getByLabelText("Name")).toHaveAccessibleDescription("Public label");
    rerender(<FormField label="Name" htmlFor="name" error="Required"><input id="name" /></FormField>);
    expect(screen.getByRole("alert")).toHaveAttribute("id", "name-error");
    expect(screen.getByLabelText("Name")).toHaveAccessibleDescription("Required");
    expect(screen.getByLabelText("Name")).toHaveAttribute("aria-invalid", "true");
  });

  it("preserves existing descriptions through nested field markup", () => {
    render(<><p id="existing">Existing description</p><FormField label="Name" htmlFor="name" hint="Public label"><div><input id="name" aria-describedby="existing" /></div></FormField></>);
    expect(screen.getByLabelText("Name")).toHaveAccessibleDescription("Existing description Public label");
  });

  it("moves tab focus with arrows and skips disabled tabs", () => {
    const onChange = vi.fn();
    render(<SegmentedTabs ariaLabel="Views" value="a" onChange={onChange} items={[{id:"a",label:"First"},{id:"b",label:"Disabled",disabled:true},{id:"c",label:"Last"}]} />);
    const first = screen.getByRole("tab", {name:"First"});
    const last = screen.getByRole("tab", {name:"Last"});
    expect(first).toHaveAttribute("tabindex", "0");
    expect(last).toHaveAttribute("tabindex", "-1");
    first.focus();
    fireEvent.keyDown(first, {key:"ArrowRight"});
    expect(last).toHaveFocus();
    expect(onChange).toHaveBeenLastCalledWith("c");
    fireEvent.keyDown(last, {key:"ArrowRight"});
    expect(first).toHaveFocus();
    fireEvent.keyDown(first, {key:"End"});
    expect(last).toHaveFocus();
    fireEvent.keyDown(last, {key:"Home"});
    expect(first).toHaveFocus();
  });

  it.each([[-10,100,0,100],[150,100,100,100],[NaN,100,0,100],[50,0,50,100]])("keeps progress semantics within its visual range (%s/%s)", (value,max,expectedValue,expectedMax) => {
    render(<ProgressBar value={value} max={max} />);
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", String(expectedValue));
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuemax", String(expectedMax));
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
