import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Pagination } from "../pagination";

vi.mock("@/lib/i18n/use-locale", () => ({ useI18n: () => ({ t: (key: string) => key }) }));

describe("Pagination", () => {
  it("disables navigation at the empty and last-page boundaries", () => {
    const onPageChange = vi.fn();
    const { rerender } = render(<Pagination page={1} pageSize={50} totalItems={0} onPageChange={onPageChange} />);
    expect(screen.getByRole("button", { name: "common.pagination.previous" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "common.pagination.next" })).toBeDisabled();
    rerender(<Pagination page={3} pageSize={50} totalItems={101} onPageChange={onPageChange} />);
    expect(screen.getByRole("button", { name: "common.pagination.next" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "common.pagination.previous" }));
    expect(onPageChange).toHaveBeenCalledWith(2);
  });

  it("submits a page jump and rejects out-of-range values", () => {
    const onPageChange = vi.fn();
    render(<Pagination page={1} pageSize={50} totalItems={1208} onPageChange={onPageChange} />);
    const input = screen.getByRole("spinbutton");
    fireEvent.change(input, { target: { value: "25" } });
    fireEvent.submit(input.closest("form")!);
    expect(onPageChange).toHaveBeenLastCalledWith(25);
    fireEvent.change(input, { target: { value: "26" } });
    fireEvent.submit(input.closest("form")!);
    expect(onPageChange).toHaveBeenCalledOnce();
  });

  it("keeps focus controls mounted but disabled during loading", () => {
    const onPageChange = vi.fn();
    const onPageSizeChange = vi.fn();
    const { rerender } = render(<Pagination page={2} pageSize={50} totalItems={1208} onPageChange={onPageChange} onPageSizeChange={onPageSizeChange} />);
    const next = screen.getByRole("button", { name: "common.pagination.next" });
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "100" } });
    expect(onPageSizeChange).toHaveBeenCalledWith(100);
    rerender(<Pagination page={2} pageSize={50} totalItems={1208} loading onPageChange={onPageChange} onPageSizeChange={onPageSizeChange} />);
    expect(screen.getByRole("button", { name: "common.pagination.next" })).toBe(next);
    for (const control of [...screen.getAllByRole("button"), screen.getByRole("combobox"), screen.getByRole("spinbutton")]) {
      expect(control).toBeDisabled();
    }
  });
});
