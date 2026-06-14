import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";

import { I18nProvider } from "@/lib/i18n/provider";
import { ThemeProvider } from "@/lib/theme/provider";
import { LanguageToggle } from "../language-toggle";
import { ThemeToggle } from "../theme-toggle";

function renderWithProviders(ui: React.ReactNode) {
  return render(
    <ThemeProvider>
      <I18nProvider>{ui}</I18nProvider>
    </ThemeProvider>,
  );
}

describe("language and theme toggles", () => {
  beforeEach(() => {
    localStorage.clear();
    document.cookie = "vps-locale=; Max-Age=0; path=/";
    document.cookie = "vps-theme=; Max-Age=0; path=/";
    document.documentElement.className = "";
    document.documentElement.lang = "zh-CN";
  });

  it("starts with the persisted language, then loads and persists saved language changes", async () => {
    const user = userEvent.setup();
    localStorage.setItem("vps-locale", "en");
    document.cookie = "vps-locale=en; path=/";

    renderWithProviders(<LanguageToggle />);

    expect(await screen.findByRole("button", { name: "Switch to Chinese" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Switch to Chinese" }));

    expect(document.documentElement.lang).toBe("zh-CN");
    expect(localStorage.getItem("vps-locale")).toBe("zh");
    expect(document.cookie).toContain("vps-locale=zh");
  });

  it("toggles light mode class globally and persists the theme choice", async () => {
    const user = userEvent.setup();

    renderWithProviders(<ThemeToggle />);

    await user.click(screen.getByRole("button", { name: "切换到浅色模式" }));

    await waitFor(() => {
      expect(document.documentElement.classList.contains("light")).toBe(true);
    });
    expect(localStorage.getItem("vps-theme")).toBe("light");
    expect(document.cookie).toContain("vps-theme=light");
  });

  it("keeps multiple theme toggles in sync because theme is global state", async () => {
    const user = userEvent.setup();

    renderWithProviders(
      <div>
        <ThemeToggle />
        <ThemeToggle />
      </div>,
    );

    expect(screen.getAllByRole("button", { name: "切换到浅色模式" })).toHaveLength(2);

    await user.click(screen.getAllByRole("button", { name: "切换到浅色模式" })[0]!);

    expect(await screen.findAllByRole("button", { name: "切换到深色模式" })).toHaveLength(2);
  });
});
