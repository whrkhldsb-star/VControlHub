/**
 * The part of the remote desktop a phone shows when the picture is zoomed in or
 * the on-screen keyboard covers its lower half.
 *
 * The content is laid out at its fitted size ("zoom 1") and drawn through
 * `translate(x, y) scale(zoom)` with the origin at its top-left corner, `x` and
 * `y` being where that corner lands in the viewport. The rules are those of any
 * photo viewer: a picture smaller than the viewport sits in the middle, a bigger
 * one can be moved until its edge meets the viewport's, never further.
 */
export type Size = { width: number; height: number };
export type ViewState = { zoom: number; x: number; y: number };

export const MIN_ZOOM = 1;
/** Far enough to read a 1080p desktop on a phone; further only blurs. */
export const MAX_ZOOM = 5;
/** A zoom this close to 1 snaps back to the fitted picture. */
const SNAP_TO_FIT = 1.04;

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

/** Where one axis of the content may sit: centred when it fits, otherwise edge to edge. */
function axis(offset: number, scaledContent: number, viewport: number): number {
  if (scaledContent <= viewport) return (viewport - scaledContent) / 2;
  return clamp(offset, viewport - scaledContent, 0);
}

export function clampView(view: ViewState, content: Size, viewport: Size): ViewState {
  let zoom = clamp(view.zoom, MIN_ZOOM, MAX_ZOOM);
  if (zoom < SNAP_TO_FIT) zoom = 1;
  return {
    zoom,
    x: axis(view.x, content.width * zoom, viewport.width),
    y: axis(view.y, content.height * zoom, viewport.height),
  };
}

/** The fitted picture in the middle of the viewport. */
export function fittedView(content: Size, viewport: Size): ViewState {
  return clampView({ zoom: 1, x: 0, y: 0 }, content, viewport);
}

/** Zooms by `factor` keeping the content under the viewport point (`fx`, `fy`) where it is. */
export function zoomAround(view: ViewState, factor: number, fx: number, fy: number, content: Size, viewport: Size): ViewState {
  const zoom = clamp(view.zoom * factor, MIN_ZOOM, MAX_ZOOM);
  const cx = (fx - view.x) / view.zoom, cy = (fy - view.y) / view.zoom;
  return clampView({ zoom, x: fx - cx * zoom, y: fy - cy * zoom }, content, viewport);
}

/** Moves the content by (`dx`, `dy`) viewport pixels. */
export function panBy(view: ViewState, dx: number, dy: number, content: Size, viewport: Size): ViewState {
  return clampView({ ...view, x: view.x + dx, y: view.y + dy }, content, viewport);
}

/**
 * Moves the view just far enough that a point of the content (in content pixels
 * at zoom 1) lies at least `margin` pixels inside the viewport. A pointer pushed
 * against the edge of a zoomed picture carries the picture with it, and the
 * pointer stays above the keyboard.
 */
export function revealPoint(view: ViewState, px: number, py: number, margin: number, content: Size, viewport: Size): ViewState {
  const m = Math.min(margin, viewport.width / 2, viewport.height / 2);
  const sx = view.x + px * view.zoom, sy = view.y + py * view.zoom;
  let dx = 0, dy = 0;
  if (sx < m) dx = m - sx;
  else if (sx > viewport.width - m) dx = viewport.width - m - sx;
  if (sy < m) dy = m - sy;
  else if (sy > viewport.height - m) dy = viewport.height - m - sy;
  return dx || dy ? panBy(view, dx, dy, content, viewport) : view;
}

/** The CSS for a view whose content box naturally sits at (`naturalX`, `naturalY`) in the viewport, or "" for the plain fitted picture. */
export function viewTransform(view: ViewState, naturalX: number, naturalY: number): string {
  const tx = view.x - naturalX, ty = view.y - naturalY;
  if (view.zoom === 1 && Math.abs(tx) < 0.5 && Math.abs(ty) < 0.5) return "";
  return `translate(${tx.toFixed(2)}px, ${ty.toFixed(2)}px) scale(${view.zoom.toFixed(4)})`;
}
