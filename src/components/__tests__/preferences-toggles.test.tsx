import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";

import { I18nProvider } from "@/lib/i18n/provider";
import { LanguageToggle } from "../language-toggle";
import { ThemeToggle } from "../theme-toggle";

describe("language and theme toggles", () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.className = "";
    document.documentElement.lang = "zh-CN";
  });

  it("switches html lang immediately and persists the language choice", async () => {
    const user = userEvent.setup();
    Object.defineProperty(navigator, "language", { value: "zh-CN", configurable: true });

    render(
      <I18nProvider>
        <LanguageToggle />
      </I18nProvider>,
    );

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "切换到英文" })).toBeInTheDocument();
    });
    await user.click(screen.getByRole("button", { name: "切换到英文" }));

    expect(document.documentElement.lang).toBe("en");
    expect(localStorage.getItem("vps-locale")).toBe("en");
  });

  it("toggles light mode class and persists the theme choice", async () => {
    const user = userEvent.setup();

    render(<ThemeToggle />);

    await user.click(screen.getByRole("button", { name: "切换到浅色模式" }));

    await waitFor(() => {
      expect(document.documentElement.classList.contains("light")).toBe(true);
    });
    expect(localStorage.getItem("vps-theme")).toBe("light");
  });
});
