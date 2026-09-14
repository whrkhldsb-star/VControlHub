# VControlHub UI System

The application uses a compact operations layout: neutral page backgrounds,
blue navigation/selection, teal primary commands, and semantic status colors.
Changes must work in Chinese and English, dark and light themes, and at 320,
768 and 1440 CSS pixels without horizontal page scrolling.

## Source Of Truth

| Concern | Implementation |
| --- | --- |
| Colors, spacing, control geometry, typography | `src/app/styles/tokens.css` |
| Shared element styles | `src/app/globals.css` |
| Page heading, statistics, toolbar, list sections | `src/components/page-shell.tsx` |
| Tabs, category rail, field labels/errors, icon buttons | `src/components/ui-primitives.tsx` |
| Commands | `src/components/action-button.tsx` |
| Status and pagination | `status-badge.tsx`, `pagination.tsx` |
| Dialog containment and focus | `src/components/modal-shell.tsx` |
| Input and select styles | `UI_INPUT` in `src/lib/ui/classes.ts` |

Use 24px page titles, 16px section titles, 14px body/control text and 12px
secondary labels. Control height is 40px; touch targets are at least 44px where
space permits. Use 4/8/12/16/24px spacing, 8px controls, 12px cards and 16px
dialogs. Keep sections unframed; reserve cards for repeated inventory items,
list containers and dialogs. Small metadata uses at least 12px text. Avoid
overriding action controls back to 10–12px or changing them into unrelated pills.

## Working Examples

Run `npm run ui:showcase -- /tmp/vcontrolhub-ui-showcase` in an isolated checkout.
Open the generated `index.html` directly. The standalone artifact bundles the
real application components and CSS; it needs no account, database or server.
It uses system sans/monospace fonts because Next's Geist loader is not present.
The controls support theme changes, keyboard tabs, pagination and dialogs.
It is a development reference, not a production application route.

Run `npm run ui:check -- /tmp/vcontrolhub-ui-showcase` after generating it to
check 18 component states in Chromium and save screenshots. Playwright Chromium
must be installed. This gate uses no application server or database.

The three representative application pages are:

- Servers: compact accessible tabs, permission-aware destinations, searchable
  inventory, combined filters, 12 mounted cards per page, consistent summaries.
- Files: existing database pagination and sorting, shared toolbar, scoped
  navigation, on-demand upload dialog and partial-sync error handling.
- Settings: shared tabs, desktop category rail/mobile select, preserved drafts,
  authorized bookmarks and a single owner for delayed navigation.

Server inventory pagination bounds both the profile query and mounted cards
to 12 rows. Search/filter/count run in PostgreSQL; operation panels load their
sanitized target options when opened. Switching inventory pages unmounts old
cards and aborts browser requests. Diagnostic cancellation closes its SSH
channel while preserving other pooled commands; detached remote processes may
continue. Do not equate a disabled/enabled node with live connectivity status.

## Interaction Rules

- Use icons with accessible names/tooltips for utilities, selects for option
  sets, switches for booleans and labeled inputs for values.
- Every tab must control a named panel and support arrow/Home/End navigation.
- Preserve unsaved settings while changing categories; changing the URL must
  preserve framework history state. Permission checks also apply to bookmarks.
- Cancel obsolete requests and delayed UI actions on navigation/unmount.
  Validate probe response bodies before showing a successful state.
- Display actionable errors next to the affected operation. Distinguish a
  failed list refresh from partially synchronized remote files.

## Verification

`e2e/ui-upgrade.spec.ts` checks the three pages across themes, languages and
widths, with accessibility scans and screenshots. Server probes are stubbed
only in this visual suite for deterministic status. Real probe behavior is
covered by the existing workflow suite and lifecycle unit tests. Fixture writes
require a loopback audit/test database and an isolated account.

## Whole-site verification

`e2e/ui-site.spec.ts` discovers concrete pages from the route catalog. Set
`UI_FULL_MATRIX=1` to inspect every discovered page in both languages, both
themes, and all three viewport widths. Every case checks headings, document
response, runtime errors, horizontal overflow and WCAG A/AA rules, and saves a
full-page screenshot. Redirect aliases and dynamic details have separate
product workflow coverage; a page sweep alone does not certify their actions.

Route skeletons use `RouteLoading` to share the completed page's gutters and
navigation clearance. Public status, media detail and file preview use the same
page heading primitives. AI keeps its conversation-specific layout and clears
the application mobile navigation through tablet widths. Error, permission,
empty and busy states remain distinct; absence of failures is not a red alert.
