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
});
