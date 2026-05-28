import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import Loading from "@/app/loading";

describe("root loading fallback", () => {
  it("renders only the page skeleton so layout-level chrome is not duplicated during streaming", () => {
    render(<Loading />);

    expect(screen.getByTestId("page-skeleton")).toBeInTheDocument();
    expect(screen.queryByRole("complementary")).not.toBeInTheDocument();
  });
});
