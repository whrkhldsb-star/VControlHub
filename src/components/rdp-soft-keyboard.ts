/**
 * The on-screen keyboard of a remote desktop on a phone or tablet, as Microsoft's
 * Remote Desktop app has it: it shows when its button is tapped and hides when
 * that button is tapped again. Tapping the desktop never raises it.
 *
 * The keyboard belongs to the browser, which shows it for as long as an editable
 * element has the focus. The desktop therefore keeps its keyboard receiver (a
 * hidden text field) at `inputmode="none"`, where focus brings no keyboard up, and
 * only this controller switches it to `text` and focuses it.
 */

/** A keyboard needs at least this much height; smaller changes are toolbars appearing. */
const KEYBOARD_MIN_HEIGHT = 120;

export type ViewportReading = {
  /** window.innerHeight */
  innerHeight: number;
  /** window.visualViewport?.height, when the browser has the API */
  visualHeight: number | null;
  /** The tallest innerHeight seen while the keyboard was closed. */
  baselineHeight: number;
};

/**
 * Whether the screen shows an on-screen keyboard. Browsers disagree on what a
 * keyboard changes: some leave the page alone and shrink only the visual viewport
 * (iOS, Android Chrome by default); this app asks Chrome for the other behaviour
 * (`interactive-widget=resizes-content`), where the page itself gets shorter.
 */
export function keyboardShowing({ innerHeight, visualHeight, baselineHeight }: ViewportReading): boolean {
  if (visualHeight !== null && innerHeight - visualHeight > KEYBOARD_MIN_HEIGHT) return true;
  return baselineHeight - innerHeight > KEYBOARD_MIN_HEIGHT;
}

export type SoftKeyboard = {
  isOpen(): boolean;
  /** Width of the window when the keyboard was opened (a change of it means the device was rotated). */
  openedAtWidth(): number;
  open(): void;
  close(): void;
  toggle(): void;
  dispose(): void;
};

export type SoftKeyboardOptions = {
  /** The hidden text field that receives what the keyboard types. */
  input: HTMLTextAreaElement;
  /** The non-editable element that has the focus when the keyboard is closed (hardware keys still arrive there). */
  surface: HTMLElement;
  onChange(open: boolean): void;
  win?: Window;
};

export function createSoftKeyboard({ input, surface, onChange, win = window }: SoftKeyboardOptions): SoftKeyboard {
  let open = false;
  let seenShowing = false;
  let width = win.innerWidth;
  let baselineHeight = win.innerHeight;
  let baselineWidth = win.innerWidth;

  // Focus alone must never raise the keyboard: a stray focus (a tap that landed on the field, a
  // script moving focus) would otherwise pop it up over the desktop.
  input.inputMode = "none";

  const reading = (): ViewportReading => ({
    innerHeight: win.innerHeight,
    visualHeight: win.visualViewport ? win.visualViewport.height : null,
    baselineHeight,
  });

  const set = (next: boolean) => {
    if (open === next) return;
    open = next;
    onChange(next);
  };

  const closeNow = () => {
    // Hide the keyboard first: a blurred field may leave it up until the next frame.
    input.inputMode = "none";
    if (win.document.activeElement === input) input.blur();
    surface.focus({ preventScroll: true });
    seenShowing = false;
    set(false);
  };

  const openNow = () => {
    width = win.innerWidth;
    seenShowing = false;
    input.inputMode = "text";
    // A field that kept the focus after the system hid the keyboard needs the focus
    // taken and given again for the keyboard to come back.
    if (win.document.activeElement === input) input.blur();
    input.focus({ preventScroll: true });
    set(true);
  };

  const onViewport = () => {
    if (!open) {
      // The page is as tall as it gets while no keyboard is up; the rotated page is another baseline.
      if (win.innerWidth !== baselineWidth) {
        baselineWidth = win.innerWidth;
        baselineHeight = win.innerHeight;
      } else if (win.innerHeight > baselineHeight) {
        baselineHeight = win.innerHeight;
      }
      return;
    }
    if (win.innerWidth !== width) {
      // Rotated: the keyboard is whatever the new orientation makes of it.
      baselineWidth = win.innerWidth;
      baselineHeight = win.innerHeight;
      closeNow();
      return;
    }
    const showing = keyboardShowing(reading());
    if (showing) seenShowing = true;
    // The keyboard was up and is gone, with no tap of ours: the system's own hide key or back gesture.
    else if (seenShowing) closeNow();
  };

  win.addEventListener("resize", onViewport);
  win.visualViewport?.addEventListener("resize", onViewport);

  return {
    isOpen: () => open,
    openedAtWidth: () => width,
    open: openNow,
    close: closeNow,
    toggle: () => (open ? closeNow() : openNow()),
    dispose() {
      win.removeEventListener("resize", onViewport);
      win.visualViewport?.removeEventListener("resize", onViewport);
      input.inputMode = "none";
      if (open) {
        if (win.document.activeElement === input) input.blur();
        open = false;
      }
    },
  };
}
