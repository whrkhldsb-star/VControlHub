import type { MetadataRoute } from "next";

import { getAppDescription, getAppName, getSiteName } from "@/lib/branding";

/**
 * Dynamic web app manifest for VControlHub (PWA support).
 *
 * Next.js 16 ships built-in manifest support — placing this file in `src/app/`
 * makes `/manifest.webmanifest` available at build time. The manifest enables:
 *
 * - "Add to home screen" install prompt on iOS / Android / desktop Chrome.
 * - Standalone display mode (no browser chrome) when launched from the
 *   home screen — gives a more app-like feel.
 * - Custom theme color and background color so the splash screen matches
 *   VControlHub's branding.
 *
 * Icons:
 * - 192x192: required minimum for "installable" PWA criterion.
 * - 512x512: required for splash screens; we reuse the existing
 *   `src/app/icon.png` (already 512x512) via the `public/` mirror.
 *
 * This file is server-only; no client-side state, so it can be statically
 * rendered and cached at the edge.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: `${getSiteName()} | ${getAppName()}`,
    short_name: getAppName(),
    description: getAppDescription(),
    start_url: "/dashboard",
    scope: "/",
    display: "standalone",
    orientation: "any",
    // The dark theme's page background and the action colour of src/app/styles/tokens.css: a manifest
    // cannot read CSS variables, so manifest.test.ts compares these two with the tokens.
    background_color: "#0e1014",
    theme_color: "#5260e8",
    categories: ["productivity", "utilities", "developer"],
    icons: [
      {
        src: "/icon-192x192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icon-192x192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "maskable",
      },
      {
        src: "/icon.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
    ],
  };
}
