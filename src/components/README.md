# Components

Shared UI primitives live here. The design rules, the token map and "how do I
change X everywhere" live in [`docs/ui-system.md`](../../docs/ui-system.md);
`npm run ui:showcase` renders every component on one page. Prefer these
exports to one-off Tailwind strings — `__tests__/ui-conventions.test.ts`
rejects pasted button sizes, hand-rolled overlays and button-styled `<Link>`s.

## Layout and surfaces (`page-shell.tsx`)

- `PageShell` — page wrapper (renders a `div`; the root layout owns `<main>`). `maxW` optional.
- `PageHeader` — title, `description`, page actions as children. Use `description` instead of a sibling paragraph so audits can verify header completeness mechanically.
- `Toolbar` — filter/command row; default bottom margin unless you pass one.
- `Card` — standard container: `title`, `description`, `actions`, `footer`, `padding`, `as`.
- `SurfacePanel` — titled card with a 16px rhythm for create forms and secondary blocks.
- `ListPanel` / `ListRow` — titled list with count, actions, hairline rows and `empty`.
- `MetricPanel`, `StatGrid` / `StatCard` — grouped figures and headline numbers.
- `Section` — titled group without chrome; `EmptyState` (`simple` | `boxed`); `PermissionDenied`.
- Surface attributes for any element: `data-card`, `data-inset` (well), `data-tile` (raised tile).

## Commands (`action-button.tsx`)

- `ActionButton` (alias `Button`) — `variant` primary · secondary · outline · ghost · success · warning · danger · success-solid · danger-solid; `size` xs · sm · md · lg; `icon`, `iconRight`, `loading`, `square`, `block`. `className` is for layout only.
- `ButtonLink` — the same look on a link (`external` for new-tab `<a>`).
- `SubmitButton` (`submit-button.tsx`) — form submit wired to `useFormStatus()` with a pending label.
- `IconButton` (`ui-primitives.tsx`) — borderless icon control with a required `label`.

## Dialogs and menus

- `Dialog` (`ui/dialog.tsx`) — header, scrollable body, `footer`; `size`, `busy`, `placement="sheet"`.
- `ConfirmDialog` (`confirm-dialog.tsx`) — confirmations; never use `window.confirm`.
- `ModalShell` (`modal-shell.tsx`) — the primitive: `size`, `placement` (center · top · sheet · drawer), `backdrop`, `padded`, `className`. Also exports `dialogOverlayClass()` / `dialogPanelClass()` for lazy-loading placeholders.
- `Disclosure` (`ui/disclosure.tsx`) — folded section (`card` | `inset`), server-safe native `<details>`.
- `Menu`, `MenuItem`, `MenuSeparator`, `MenuLabel`, `useDismiss` (`ui/menu.tsx`) — dropdown menus and outside-click/Escape handling; style custom popovers with `data-popover` / `data-menu-item`.

## Status, forms and data (`ui-primitives.tsx`, `status-badge.tsx`, `ui/key-value.tsx`)

- `StatusBadge` — state of a thing (pill with dot). `Badge` — tag or label.
- `Notice` — inline message (`tone`, `title`, `action`, dismiss). `Callout`, `StateBox` for legacy surfaces.
- `FormField`, `FormGrid`, `CheckboxField`, `Switch`, `SegmentedTabs` (`underline` | `pills`), `TabNav` (link tabs), `SideNav`, `SplitPane`.
- `Spinner`, `InlineLoading`, `ProgressBar`; skeletons in `skeleton.tsx`.
- `KeyValueList` — label/value pairs (`columns`, `layout`, `mono`, `wide`).
- Field chrome: the `.ui-control` rule in `globals.css`; `UI_INPUT` (= `"ui-control"`) / `UI_LABEL` from `src/lib/ui/classes.ts` (`CONTROL_CLASS` re-exports `UI_INPUT`).
- Keep `ui-primitives.tsx` free of hooks and browser APIs so importing it does not create a client boundary.

## Navigation and shell

- `nav-items.tsx` — the navigation catalogue: groups, icons, mobile tabs, `findNavLocation()` for breadcrumbs.
- `nav-icons.tsx` — the outline icon set used by the shell, plus `BrandMark` / `BrandTile`.
- `AppSidebar` — collapsible groups, pins, quick services, collapsed rail, mobile drawer, `UserMenu` at the foot.
- `AppTopbar` — breadcrumb, search, notifications, theme and language; names the tab and records recent pages.
- `GlobalSearch` — command palette (⌘K / `/`): recent pages, actions, pages, resources.
- `KeyboardShortcuts` — `?` help, `G`+letter navigation, `[` sidebar. `SkipLink` — first focusable element.
- `MobileNav` — four tabs and "More" (opens the sidebar drawer).
- `NotificationBell`, `LanguageToggle`, `ThemeToggle`, `TeamSwitcher`, `SignOutButton`, `SidebarLoader`.
- `SshTerminalPanel` — canonical multi-tab SSH terminal implementation; keep terminal connection behaviour here instead of adding a second modal implementation.

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

- `cn` — tiny className combiner (no clsx/tailwind-merge: it does not resolve conflicting utilities, so size and colour belong in component props).
- `classes` — `UI_INPUT`, `UI_LABEL` and the `UI_TONE` map; everything else has a component or data attribute.
- `shell-preferences` — sidebar collapse, pins, open groups and recent pages (localStorage + the `vch-sidebar` cookie).

## UI System Reference

See [the UI system guide](../../docs/ui-system.md) for the shared tokens,
representative pages, standalone component examples and browser verification.
