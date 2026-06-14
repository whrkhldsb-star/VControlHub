import { act, render, renderHook, screen } from "@testing-library/react";
import { useEffect } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ThemeProvider, useTheme } from "@/lib/theme/use-theme";

function CookieReader() {
  const { theme } = useTheme();
  return <span data-testid="theme">{theme}</span>;
}

type Theme = "dark" | "light";
type Setter = (t: Theme) => void;
type Toggle = () => void;

describe("theme useTheme / ThemeProvider", () => {
  beforeEach(() => {
    document.documentElement.className = "";
    document.documentElement.removeAttribute("data-theme");
    document.cookie = "vps-theme=; path=/; max-age=0";
    window.localStorage.clear();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("throws if useTheme is used outside a ThemeProvider", () => {
    // Suppress the React error boundary console.error noise.
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => renderHook(() => useTheme())).toThrow(/ThemeProvider/);
    spy.mockRestore();
  });

  it("starts with the initial theme", () => {
    render(
      <ThemeProvider initialTheme="light">
        <CookieReader />
      </ThemeProvider>,
    );
    expect(screen.getByTestId("theme").textContent).toBe("light");
    expect(document.documentElement.classList.contains("light")).toBe(true);
    expect(document.documentElement.dataset.theme).toBe("light");
  });

  it("setTheme updates DOM, localStorage, and cookie", () => {
    const setThemeRef = { current: null as null | Setter };
    function Probe() {
      const { theme, setTheme } = useTheme();
      // Sync the setter to the outer ref via an effect so the test driver
      // can invoke it from outside the component. Writing .current inside
      // the render body would mutate a shared object during render.
      useEffect(() => {
        setThemeRef.current = setTheme;
      });
      return <span>{theme}</span>;
    }
    render(
      <ThemeProvider initialTheme="dark">
        <Probe />
      </ThemeProvider>,
    );
    act(() => setThemeRef.current?.("light"));
    expect(document.documentElement.dataset.theme).toBe("light");
    expect(document.documentElement.classList.contains("light")).toBe(true);
    expect(window.localStorage.getItem("vps-theme")).toBe("light");
    expect(document.cookie).toMatch(/vps-theme=light/);
  });

  it("toggleTheme flips dark <-> light", () => {
    const toggleRef = { current: null as null | Toggle };
    function Probe() {
      const { theme, toggleTheme } = useTheme();
      useEffect(() => {
        toggleRef.current = toggleTheme;
      });
      return <span data-testid="t">{theme}</span>;
    }
    render(
      <ThemeProvider initialTheme="dark">
        <Probe />
      </ThemeProvider>,
    );
    act(() => toggleRef.current?.());
    expect(screen.getByTestId("t").textContent).toBe("light");
    expect(document.documentElement.dataset.theme).toBe("light");
    act(() => toggleRef.current?.());
    expect(screen.getByTestId("t").textContent).toBe("dark");
    expect(document.documentElement.dataset.theme).toBe("dark");
  });

  it("hydrates from localStorage on mount if a stored value exists", () => {
    window.localStorage.setItem("vps-theme", "light");
    render(
      <ThemeProvider initialTheme="dark">
        <CookieReader />
      </ThemeProvider>,
    );
    // After mount effect runs, the DOM should reflect the stored theme.
    expect(document.documentElement.dataset.theme).toBe("light");
  });

  it("ignores an invalid stored value and falls back to initialTheme", () => {
    window.localStorage.setItem("vps-theme", "blue");
    render(
      <ThemeProvider initialTheme="dark">
        <CookieReader />
      </ThemeProvider>,
    );
    expect(document.documentElement.dataset.theme).toBe("dark");
  });

  it("survives localStorage access failures", () => {
    const getItemSpy = vi
      .spyOn(window.localStorage.__proto__, "getItem")
      .mockImplementation(() => {
        throw new Error("quota");
      });
    render(
      <ThemeProvider initialTheme="light">
        <CookieReader />
      </ThemeProvider>,
    );
    expect(document.documentElement.dataset.theme).toBe("light");
    getItemSpy.mockRestore();
  });

  it("multiple consumers stay in sync with a shared provider", () => {
    function A() {
      const { theme } = useTheme();
      return <span data-testid="a">{theme}</span>;
    }
    function B() {
      const { theme, setTheme } = useTheme();
      return (
        <button data-testid="b" onClick={() => setTheme("light")}>
          {theme}
        </button>
      );
    }
    render(
      <ThemeProvider initialTheme="dark">
        <A />
        <B />
      </ThemeProvider>,
    );
    act(() => {
      (screen.getByTestId("b") as HTMLButtonElement).click();
    });
    expect(screen.getByTestId("a").textContent).toBe("light");
  });
});
