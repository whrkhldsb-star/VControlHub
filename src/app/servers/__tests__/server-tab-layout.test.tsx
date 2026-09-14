import { fireEvent, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { renderWithI18n } from "@/lib/i18n/__tests__/test-helpers";
import { ServerTabLayout } from "../server-tab-layout";

afterEach(() => window.history.replaceState(null, "", "/"));

it("omits unavailable tabs, handles keyboard navigation and preserves router state", () => {
  window.history.replaceState({ marker: "router" }, "", "#servers-create");
  renderWithI18n(<ServerTabLayout nodesPanel={<p>Inventory</p>} commandPanel={<p>Commands</p>} />);
  expect(screen.getAllByRole("tab")).toHaveLength(2);
  const tabs = screen.getAllByRole("tab");
  expect(screen.getByRole("tabpanel")).toHaveTextContent("Inventory");
  tabs[0]!.focus();
  fireEvent.keyDown(tabs[0]!, { key: "ArrowRight" });
  expect(tabs[1]).toHaveFocus();
  expect(tabs[1]).toHaveAttribute("aria-selected", "true");
  const panel = screen.getByRole("tabpanel");
  expect(panel).toHaveTextContent("Commands");
  expect(panel).toHaveAttribute("aria-labelledby", tabs[1]!.id);
  expect(tabs[1]).toHaveAttribute("aria-controls", panel.id);
  expect(window.location.hash).toBe("#servers-command");
  expect(window.history.state).toEqual({ marker: "router" });
});

it("opens authorized bookmarks", () => {
  window.history.replaceState(null, "", "#servers-create");
  renderWithI18n(<ServerTabLayout nodesPanel={<p>Inventory</p>} createPanel={<p>Create</p>} />);
  expect(screen.getByRole("tabpanel")).toHaveTextContent("Create");
});
