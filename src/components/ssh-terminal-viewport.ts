"use client";

import { useMemo, useSyncExternalStore } from "react";

export type ViewportBox = { height: number; offsetTop: number };

type VisualViewportLike = Pick<VisualViewport, "height" | "offsetTop" | "scale">;

/**
 * The part of the page the user can actually see.
 *
 * On a phone the on-screen keyboard covers the lower part of the layout
 * viewport without shrinking it (always on iOS, and on Android unless the
 * page asks for `interactive-widget=resizes-content`), so a terminal sized to
 * `100dvh` keeps its prompt behind the keys. The visual viewport reports the
 * uncovered area and where it sits. Pinch zoom also shrinks the visual
 * viewport, but hides nothing, so the layout height stands then.
 */
export function measureVisualViewport(viewport: VisualViewportLike, layoutHeight: number): ViewportBox {
	if (viewport.scale > 1.01) return { height: layoutHeight, offsetTop: 0 };
	return { height: Math.round(viewport.height), offsetTop: Math.round(viewport.offsetTop) };
}

function subscribe(onChange: () => void): () => void {
	const viewport = window.visualViewport;
	window.addEventListener("resize", onChange);
	viewport?.addEventListener("resize", onChange);
	viewport?.addEventListener("scroll", onChange);
	return () => {
		window.removeEventListener("resize", onChange);
		viewport?.removeEventListener("resize", onChange);
		viewport?.removeEventListener("scroll", onChange);
	};
}

function getSnapshot(): string {
	const viewport = window.visualViewport;
	if (!viewport) return "";
	const box = measureVisualViewport(viewport, window.innerHeight);
	return `${box.height}:${box.offsetTop}`;
}

function getServerSnapshot(): string {
	return "";
}

/** Null before hydration and in browsers without the Visual Viewport API. */
export function useVisualViewportBox(): ViewportBox | null {
	const snapshot = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
	return useMemo(() => {
		if (!snapshot) return null;
		const [height, offsetTop] = snapshot.split(":").map(Number);
		return { height: height ?? 0, offsetTop: offsetTop ?? 0 };
	}, [snapshot]);
}
