# Agent Session Monitor — Precision Instrument

## Product posture

The dashboard is an AI-agent control tower: dense, exact, calm, and operational. It should feel like a precision instrument rather than a collection of generic dashboard cards. The table is the primary surface; navigation, filtering, incidents, and inspection exist to support it.

## Foundation

- Astryx Neutral remains the base theme, preserving its cool graphite surfaces, neutral elevation ladder, blue accent, and semantic status colors.
- Instrument Sans is the UI and heading face. IBM Plex Mono is the data face for identifiers, branches, timestamps, cost, token counts, and other numeric telemetry.
- All spacing, radius, color, elevation, and motion values resolve through Astryx tokens. No page-level `--color-*` overrides are allowed.
- Numerals use tabular variants throughout telemetry and counters.

## Frame budget

- Full frame: `AppShell` with top navigation and `SideNav`.
- Desktop navigation: the Astryx side-nav width; content consumes the remaining inline space.
- Primary workspace: `Layout` with edge-to-edge `LayoutContent` for the table.
- Inspector: `LayoutPanel`, 420px default, resizable from 380px to 520px.
- At 1024px and below, the inspector overlays the content instead of compressing it.
- At 768px and below, the navigation collapses and the header reduces to brand, live state, and search. Status summary remains available as a horizontally scrollable strip without increasing document width.
- At 375px, neither the document nor the top navigation may overflow horizontally.

## Surface hierarchy

1. Body: cool graphite workspace.
2. Navigation and table chrome: elevated surface separated by a one-token border.
3. Active or focused state: the single accent, used as a rail or focus ring.
4. Hover: immediate muted surface lift; no perceptible lag.
5. Popovers and inspector: elevated surface with Astryx shadow tokens.

## Operational language

- Running: success green and a restrained CSS-only live pulse.
- Waiting, approval required, blocked, and stale: warning amber only when their meaning requires attention.
- Failed: error red.
- Completed, paused, and offline: neutral.
- Status is always dot plus text in a compact capsule; color never carries meaning alone.
- Running progress is indeterminate. No percentage is inferred. Known progress uses a 2px track; unknown progress uses an animated 2px signal.

## Table contract

- Every data cell is one line, truncated at its column boundary, with its complete value available through a native title tooltip.
- Project and branch share one compact mono row: project first, branch secondary.
- Column widths prioritize identity, task, project, status, and updated time. Lower-priority telemetry remains available through column visibility controls.
- Row density stays user-selectable. Both compact and comfortable modes preserve a deliberate baseline rhythm.
- Hover raises the row surface subtly; selection adds an accent rail without changing the data.
- The table owns any unavoidable inline scrolling. The page never does.
- Empty filtered results, zero sessions, initial loading, and fatal loading errors have designed in-region states.

## Header and navigation

- The wordmark combines a small instrument mark with “Agent Session Monitor”; it remains the strongest label in the header.
- Status counts form one segmented, clickable statistics strip wired to the existing filters.
- Connection state is a live indicator with concise copy. Search is the primary header action.
- Sidebar section labels are quiet and uppercase; item counts align on the right in mono. The selected item has an accent rail.

## Motion and accessibility

- Motion is CSS-only and limited to focus, hover, state changes, live pulse, and indeterminate progress.
- Durations and easing use Astryx motion tokens.
- `prefers-reduced-motion: reduce` removes continuous motion and collapses transitions.
- Focus rings remain visible, semantic structure is preserved, and both themes must pass axe color-contrast checks.

## Visual QA matrix

Every production QA pass covers 1600, 1280, 768, and 375 widths in dark and light modes. Each pass records screenshots and verifies document overflow, header bounds, single-line project/branch cells, 2px progress, font assignment, loading/empty/error treatment, and the seven CTO diagnostic findings.
