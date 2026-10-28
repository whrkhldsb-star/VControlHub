import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { renderContent } from "../ai-markdown-renderer";

describe("AI markdown renderer", () => {
  it.each([
    ["table", "方案如下：\n| 命令"],
    ["heading", "方案如下：\n# "],
    ["unordered list", "方案如下：\n- "],
    ["ordered list", "方案如下：\n1. "],
  ])("renders an incomplete streamed %s as text without hanging", (_name, markdown) => {
    const { container } = render(
      <div>{renderContent(markdown)}</div>,
    );

    expect(container).toHaveTextContent("方案如下：");
  });

  it("still renders complete table rows as a table", () => {
    const { container } = render(
      <div>{renderContent("| 命令 | 说明 |\n| --- | --- |\n| echo ok | 验证 |")}</div>,
    );

    expect(container.querySelector("table")).not.toBeNull();
    expect(screen.getByText("echo ok")).toBeInTheDocument();
  });

  it("shows a fenced code block indented under a list item, and keeps the steps numbered", () => {
    // The usual "steps with commands" layout: the block was dropped (only "CODE0" was left in the page) and the list
    // started again from 1 after it.
    const { container } = render(
      <div>{renderContent("1. Install:\n   ```bash\n   npm i foo\n   ```\n2. Run it")}</div>,
    );

    expect(container.querySelector("code")).toHaveTextContent("npm i foo");
    expect(container.querySelector("code")!.textContent).toBe("npm i foo\n");
    expect(container.textContent).not.toContain("CODE");
    expect(container.textContent).not.toContain("\0");
    const lists = container.querySelectorAll("ol");
    expect(lists).toHaveLength(2);
    expect(lists[1]).toHaveAttribute("start", "2");
    expect(lists[0]).not.toHaveAttribute("start");
  });

  it("shows a fence that follows text on its line, and a fence written on one line", () => {
    const { container } = render(
      <div>{renderContent("Run this: ```bash\nls -la\n```\nthen ```df -h``` to check")}</div>,
    );

    const codes = [...container.querySelectorAll("code")].map((code) => code.textContent);
    expect(codes).toEqual(["ls -la\n", "df -h"]);
    expect(container).toHaveTextContent("Run this:");
    expect(container.textContent).not.toContain("CODE");
  });

  it("does not let text forge a placeholder with its own NUL characters", () => {
    expect(() => render(<div>{renderContent("\0CODE9\0\nplain")}</div>)).not.toThrow();
  });
});
