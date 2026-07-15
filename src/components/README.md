# Components

Shared UI primitives live here. Prefer these exports before adding one-off Tailwind class strings in route components.

## Layout primitives

- `PageShell` (`page-shell.tsx`) — dashboard page wrapper. It intentionally renders a `div`, not a nested `main`, because the root app layout already owns the page `<main>`.
  - Props: `children`, optional `maxW` Tailwind max-width class.
- `PageHeader` (`page-shell.tsx`) — standard page title block with eyebrow, title, optional description, and optional right-side actions.
  - Props: `eyebrow`, `title`, optional `description`, optional `children`, optional `className`.
  - Use `description` instead of a sibling paragraph so audits can verify header completeness mechanically.
- `Card` (`page-shell.tsx`) — thin `[data-card]` wrapper for card surfaces.
- `EmptyState` (`page-shell.tsx`) — empty-list placeholder.
  - Props: optional `text`, optional rich `children`, `variant="simple" | "boxed"`, optional `icon`.
  - Use rich `children` when the empty state needs a hint / CTA line.
- `StatCard` (`page-shell.tsx`) — compact metric card with optional accent color.
- `PermissionDenied` (`page-shell.tsx`) — shared permission-denied page surface.

## Actions and forms

- `ActionButton` (`action-button.tsx`) — canonical token-backed button (`primary` | `outline` | `ghost` | `success` | `danger` | `secondary`).
- `SubmitButton` — same token variants + pending label for forms; use `className` for layout only (`w-full`).
  - Props: native button props plus `variant="primary" | "outline" | "ghost"`.
  - Use this instead of hand-written `bg-cyan-*` classes for new action buttons.
- `SubmitButton` (`submit-button.tsx`) — form-action submit button wired to `useFormStatus()`.
  - Props: `pendingLabel`, `children`, optional `className`, `name`, `value`, `disabled`.
  - With no `className`, it uses the same `[data-action-button]` token styling as `ActionButton`.
- `Input` / `StateBox` (`ui-primitives.tsx`) — server-safe form and feedback primitives used by authentication surfaces.
- `Badge` / `Card` / `Spinner` / `ProgressBar` (`ui-primitives.tsx`) — server-safe presentation primitives. Keep this module free of hooks and browser APIs so importing it does not create a client boundary.

## Navigation and shell

- `AppSidebar` / `MobileNav` — responsive app navigation surfaces using the shared `nav-items.tsx` catalog.
- `GlobalSearch` — command-palette style navigation search over the same route catalog.
- `NotificationBell` — notification popover trigger and list.
- `LanguageToggle` / `ThemeToggle` — global locale and theme controls.
- `SidebarLoader` — skeleton for lazy sidebar states.
- `SshTerminalPanel` — canonical multi-tab SSH terminal implementation; keep terminal connection behavior here instead of adding a second modal implementation.

## Feedback and system surfaces

- `ToastProvider` — lightweight in-app toast queue.
- `RouteError` — localized route-level error boundary surface; `ForbiddenError` delegates to `PermissionDenied`.
- `ChangePasswordModal` — localized password-change modal.
- `TwoFactorSettings` — localized 2FA settings panel.
- `PwaRegister` — service-worker registration helper.

## Media and storage

- `media/ChunkedUploader` — chunked upload component for media flows.
- `storage/FileUploadDropzone` — shared LOCAL/SFTP file upload dropzone used by Files and Image Bed.

## Skeletons

`skeleton.tsx` exports shared loading placeholders, including page-specific skeletons for data-heavy surfaces. Prefer reusing or extending these before creating a new route-local skeleton.

## Conventions

- Keep user-visible strings localized through `useI18n()` / dictionaries unless the caller passes already-localized text.
- Prefer semantic CSS tokens (`var(--text-secondary)`, `var(--border)`, `--accent*`) over new hard-coded color classes.
- Before adding a new shared component, check whether a route-local pattern can be expressed by the primitives above and semantic CSS tokens.


## Shared class utilities (`src/lib/ui/`)

- `cn` — tiny className combiner (no clsx dependency).
- `classes` — reusable token-backed Tailwind fragments (`UI_BTN_PRIMARY`, `UI_INPUT`, …).
- Prefer `ActionButton` / `page-shell` / `ui-primitives` components over copying fragment strings when a full control fits.
