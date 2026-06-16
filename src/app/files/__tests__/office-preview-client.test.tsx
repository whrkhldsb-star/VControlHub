import { screen } from "@testing-library/react";
import { renderWithI18n as render } from "@/lib/i18n/__tests__/test-helpers";
import { describe, expect, it } from "vitest";

import { OfficePreviewClient } from "../preview/office-preview-client";

describe("OfficePreviewClient", () => {
  it("does not iframe Microsoft Office Online for protected storage previews", () => {
    const { container } = render(
      <OfficePreviewClient
        href="/api/storage/sftp-download?nodeId=node_1&path=docs%2Freport.docx"
        name="report.docx"
        driver="SFTP"
      />,
    );

    expect(container.querySelector("iframe")).not.toBeInTheDocument();
    expect(screen.getByText(/暂不支持稳定在线渲染预览/)).toBeInTheDocument();
    expect(screen.getByText(/不会把私有文件暴露为公网直连地址/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "⬇ 下载文件" })).toHaveAttribute(
      "href",
      "/api/storage/sftp-download?nodeId=node_1&path=docs%2Freport.docx&download=1",
    );
  });
});
