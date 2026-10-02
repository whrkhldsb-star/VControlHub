# VControlHub UI System

VControlHub is an operations console: people scan state, act, and leave. The
interface is calm and dense — neutral graphite (dark) or paper (light)
surfaces, one indigo brand colour reserved for the primary command of a view,
and semantic colour (green, amber, red, blue) only where something has a
state. Every change must work in Chinese and English, dark and light themes,
and at 320, 768 and 1440 CSS pixels without horizontal page scrolling.

The system is built so that **changing the look is a one-file edit**: colours
and geometry are tokens, every recurring element is a component or a data
attribute styled in one place, and tests stop new code from pasting styles
back into pages.

## Where things live

| Concern | Source of truth |
| --- | --- |
| Colours, radii, control heights, shadows, fonts, z-index, brand gradient | `src/app/styles/tokens.css` |
| Element styles keyed by data attributes (buttons, surfaces, menus, dialogs, tables) | `src/app/globals.css` (`@layer components`) |
| Fields (inputs, selects, textareas) | the `.ui-control` rule in `globals.css`; `UI_INPUT` (= `"ui-control"`) and `UI_LABEL` in `src/lib/ui/classes.ts` |
| Buttons and button-styled links | `src/components/action-button.tsx` |
| Dialog chrome: widths, overlays, placements | `src/components/modal-shell.tsx` |
| Content dialog layout (header / body / footer) | `src/components/ui/dialog.tsx` |
| Menus and click-outside / Escape handling | `src/components/ui/menu.tsx` |
| Label / value lists | `src/components/ui/key-value.tsx` |
| Folded sections | `src/components/ui/disclosure.tsx` |
| Page layout, cards, lists, metrics, empty states | `src/components/page-shell.tsx` |
| Badges, notices, fields, tabs, switches, progress | `src/components/ui-primitives.tsx`, `status-badge.tsx` |
| Icons: navigation set and general set | `src/components/nav-icons.tsx`, `src/components/icons.tsx` |
| Navigation catalogue (groups, icons, mobile tabs, breadcrumbs) | `src/components/nav-items.tsx` |
| Shell: sidebar, top bar, command palette, shortcuts | `app-sidebar.tsx`, `app-topbar.tsx`, `global-search.tsx`, `keyboard-shortcuts.tsx` |

## Changing the look

| To change… | Edit |
| --- | --- |
| Brand colour | `--color-action*` (commands) and `--accent*` (links, selection) in both theme blocks of `tokens.css`; `--brand-gradient` for the logo tile |
| Corner radius | `--radius-control` (8px), `--radius-card` (12px), `--radius-dialog` (14px) |
| Control height / touch targets | `--control-height`, `--control-height-sm`, `--control-height-xs`; the `(pointer: coarse)` block raises them to `--touch-target` (44px) |
| Every button of a variant | the `[data-action-button][data-variant="…"]` rule in `globals.css` |
| Every card / well / tile | `[data-card]`, `[data-inset]`, `[data-tile]` in `globals.css` |
| Every dialog | `DIALOG_WIDTH`, `DIALOG_OVERLAY`, `dialogPanelClass` in `modal-shell.tsx`; motion in the Overlays section of `globals.css` |
| Every menu or popover | `[data-popover]`, `[data-menu-item]` in `globals.css` |
| Fields | `.ui-control` in `globals.css` (borders, background, padding, focus, disabled, placeholder) |
| Tables inside pages | the Tables section of `globals.css` (applies to every `<table>` under `PageShell`) |

Contrast is part of the token contract: text/background pairs in both themes
meet WCAG AA (4.5:1). `src/__tests__/design-tokens-action-color.test.ts`
checks the token file; `npm run ui:check` runs axe on every component state.

## Components

### Commands

- **`ActionButton`** (alias `Button`) — `variant`: `primary` (one per view),
  `secondary` (default for everything else), `outline` (prominent secondary,
  also the "on" state of a toggle), `ghost` (toolbars, low emphasis),
  `success` / `warning` / `danger` (neutral at rest, semantic text),
  `success-solid` / `danger-solid` (confirmations). `size`: `xs` · `sm` · `md`
  (default) · `lg`. `icon` / `iconRight` take an SVG; `loading` swaps the icon
  for a spinner and disables the button; `square` makes an icon-only button
  (give it an `aria-label`); `block` stretches it. `className` is for layout
  only (`ml-auto`, `w-full`), never for size or colour.
- **`ButtonLink`** — the same look on a link (`next/link`, or a plain `<a>`
  with `external`). Plain `<a download>` links to API routes may carry the
  data attributes directly: `data-action-button data-variant data-size`.
- **`SubmitButton`** — form submit with `useFormStatus` pending label.
- **`IconButton`** — borderless icon control with a required label.
- Create buttons carry a `Plus` icon; never put `+`, emoji or arrows into a
  translated label.

### Surfaces

- **`Card`** — the standard container (`[data-card]`). `title`,
  `description`, `actions` render the header row; `footer` renders a
  hairline-separated action strip; `padding`: `none` · `sm` · `md` · `lg`;
  `as` picks the element.
- **`data-inset`** — a well inside a card (grouped fields, previews,
  sub-items). **`data-tile`** — a raised tile (metric cells, options).
  Both are attributes so any element can be a surface; keep padding classes
  at the call site.
- **`ListPanel` / `ListRow`** — titled list with count, actions and hairline
  rows; pass `empty` for the empty state.
- **`SurfacePanel`** — titled card for create forms and secondary blocks.
- **`MetricPanel`** — a group of related figures in one card;
  **`StatGrid` / `StatCard`** — headline numbers under a page header.
- **`EmptyState`** — `simple` inside a panel, `boxed` on its own.
- **`Disclosure`** — a folded section (advanced settings, migration tools,
  raw commands): `variant="card"` for page-level blocks (its title is an
  `<h2>`), `variant="inset"` inside a card or row. Native `<details>`, so it
  works in server components; no "(click to expand)" in labels — the chevron
  says it.

### Status and feedback

- **`StatusBadge`** — the state of a thing (online, failed, paused): pill
  with a dot. **`Badge`** — a label or tag (channel, category, count).
- **`Notice`** — inline message with `tone` (`info`, `success`, `warning`,
  `danger`, `neutral`), optional `title`, `action` and dismiss. Use it instead
  of tinted boxes; whole cards are never coloured by state — put a
  `StatusBadge` on a neutral card.
- **`useToast`** — transient confirmation after an action.
- **`Spinner`**, **`InlineLoading`**, **`ProgressBar`**, skeletons in `skeleton.tsx`.

### Dialogs

- **`Dialog`** — content dialog: `title`, `description`, scrollable body,
  `footer` for actions, `size`, `busy` (locks Escape/backdrop while a request
  runs), `placement="sheet"` for a bottom sheet on phones.
- **`ConfirmDialog`** — destructive or important confirmations.
- **`ModalShell`** — the primitive underneath, for custom layouts:
  `size` `sm` (24rem) · `md` (28rem, default) · `lg` (32rem) · `xl` (42rem) ·
  `2xl` (48rem) · `full` (64rem); `placement` `center` · `top` (tall,
  scrolling content) · `sheet` · `drawer` (right-hand panel); `backdrop`
  `default` · `strong` (media, terminals); `padded={false}` when the content
  lays out its own sections; `className` for layout only. `overlayClassName`
  and `panelClassName` replace the chrome entirely and are reserved for the
  command palette and the inline diff review.

### Menus

- **`Menu`** + **`MenuItem`** (`href` or `onSelect`, `icon`, `description`,
  `hint`, `danger`, `disabled`), **`MenuSeparator`**, **`MenuLabel`** — closes
  on outside click, Escape (focus returns to the trigger) and selection;
  arrow keys, Home and End move between items.
- **`useDismiss`** — the same outside-click / Escape behaviour for custom
  popovers (account menu, notifications, model switcher). Style their panel
  with `data-popover` and rows with `data-menu-item`.

### Forms and data

- **`FormField`** (label, hint, error, wiring of `aria-describedby`),
  **`FormGrid`**, **`CheckboxField`**, **`Switch`**, **`SegmentedTabs`**
  (`variant="underline"` for page tabs, `"pills"` for filters) and
  **`TabNav`**, the same tabs as links between pages; both share
  `tabItemClass`.
- Fields use `UI_INPUT`; selects get the chevron automatically. Because the
  field look is a components-layer rule, a width or size utility next to it
  always wins: `cn(UI_INPUT, "w-40")` is 10rem wide.
- **`KeyValueList`** — label/value pairs (`columns`, `layout="inline"`,
  `mono` for hosts and ids, `wide` for long values, an em dash when empty).
- Tables inside `PageShell` are styled globally; write plain `<table>` markup.

### Page layout

`PageShell` (width and gutters) → `PageHeader` (title, description, page
actions; link to another page only when it is the next step of this page's
workflow — general navigation belongs to the sidebar and ⌘K) →
`Toolbar` (filters and commands) → content. Inside the application shell the
breadcrumb names the area, so page eyebrows are hidden.

## Application shell

- **Sidebar** — collapsible groups (state remembered per browser), a pinned
  section (star any page), quick-service links, a collapsed icon rail
  (`[` toggles; the choice is stored in the `vch-sidebar` cookie so the server
  renders the right width), and the account menu at the foot (workspace,
  security, password, preferences, shortcuts, theme, language, sign out).
- **Top bar** — breadcrumb from `findNavLocation`, search, notifications,
  theme and language; it also names the browser tab and records recent pages.
- **Command palette** (⌘K / Ctrl+K or `/`) — recent pages, actions (theme,
  language, sidebar, shortcuts), pages and resources.
- **Shortcuts** (`?` lists them) — `G` then a letter jumps to a page (D
  dashboard, S servers, F files, T tasks, M monitoring, A alerts, R requests,
  N notifications, I AI, `,` settings). Shortcuts never fire while typing in a
  field, editor or terminal.
- **Phones** — four tabs (dashboard, servers, tasks, files) and "More", which
  opens the full navigation drawer.

## Interaction rules

- Use icons with accessible names or tooltips for utilities, selects for
  option sets, switches for booleans and labelled inputs for values.
- Every tab controls a named panel and supports arrow / Home / End keys.
- Preserve unsaved settings while changing categories; changing the URL must
  preserve framework history state. Permission checks also apply to bookmarks.
- Cancel obsolete requests and delayed UI actions on navigation or unmount.
  Validate probe response bodies before showing a successful state.
- Show actionable errors next to the affected operation. Distinguish a failed
  list refresh from partially synchronised remote files.
- One primary button per view; destructive actions confirm in-app
  (`ConfirmDialog`), never with `window.confirm`.

## Rules enforced by tests

`src/components/__tests__/ui-conventions.test.ts` fails when new code:

- sizes an `ActionButton` / `ButtonLink` with `!px-` / `!py-` / `!text-` /
  `!min-h-` / `!rounded` overrides instead of `size` / `square`;
- renders `<Link data-action-button>` instead of `<ButtonLink>`;
- passes `overlayClassName` / `panelClassName` to `ModalShell` outside the
  allowlist, or hand-rolls a `fixed inset-0` overlay;
- uses the legacy `data-primary` attribute;
- starts a translated label with `+ `.

`src/components/__tests__/data-tone-vocabulary.test.ts` keeps `data-tone` to
the hue names that `globals.css` defines. Test helpers in
`src/test/ui-assertions.ts` check touch targets and bottom sheets through the
data attributes rather than pixel classes.

## Tailwind 4 notes

- `cn()` joins classes; it does not resolve conflicts. Two utilities for the
  same property (`mb-4` and `mb-0`) both ship and CSS order decides — use a
  component prop (`size`, `padding`) instead of overriding.
- `space-y-*` is zero-specificity in Tailwind 4, so a child's own margin
  utility (`mb-0`) silently removes the gap. Prefer `flex flex-col gap-*` for
  page sections; `Toolbar` and `StatGrid` drop their default margin when you
  pass one.
- Arbitrary `bg-[var(--x)]` is a colour; gradients need `bg-[image:var(--x)]`.

## Verification

- `npm run ui:showcase -- <dir>` builds a standalone reference page with every
  shared component (no server or database needed); `npm run ui:check -- <dir>`
  checks it at 320/768/1440px in both themes for overflow, axe WCAG A/AA and
  runtime errors, and saves screenshots. Rebuild it after changing tokens or
  a component.
- `e2e/ui-upgrade.spec.ts` checks the servers, files and settings pages across
  themes, languages and widths with accessibility scans and screenshots.
  Server probes are stubbed only in this visual suite; fixture writes require a
  loopback audit/test database and an isolated account.
- `e2e/ui-site.spec.ts` discovers concrete pages from the route catalog. Set
  `UI_FULL_MATRIX=1` to inspect every page in both languages, both themes and
  all three widths (headings, document response, runtime errors, horizontal
  overflow, WCAG A/AA, full-page screenshot).

Route skeletons use `RouteLoading` to share the finished page's gutters.
Error, permission, empty and busy states remain distinct; the absence of
failures is not a red alert.
