# ADR 0001: UI stack

- Status: Accepted
- Date: 2026-11-17
- Deciders: project owner

## Context

Finance is a personal, open-source, local-first app for managing household
finances (budgets, savings, wealth). The technical base is current (React 19,
Vite 8, TypeScript 6), but the UI layer is hand-written CSS split across several
files, with no component library and no shared rules. In practice this produced
inconsistent page headers, several page widths, a large number of ad-hoc font
sizes, and a planning editor whose rows stack name, amount, arrows and delete
on one line.

The app is expected to grow (wealth tracking, investments, loans, goals, see
[ADR 0002](./0002-wealth-tracking.md)), which needs a consistent design system,
accessible primitives, tables, drag and drop, and time-series charts.

The domain layer (`src/domain/**`), local storage and Supabase sync are not
affected by this decision and keep their document format.

## Decision

Rebuild the UI layer on this stack and keep the domain untouched.

| Concern | Choice | Notes |
| --- | --- | --- |
| Styling | Tailwind CSS v4 (`@tailwindcss/vite`) | Existing light/dark palette ported to `@theme` tokens; one spacing, type and radius scale. |
| Components | shadcn/ui on its default primitive layer | Components are copied into the repo (`src/components/ui`) and owned by the project. |
| Primitive layer | Base UI or Radix, **confirmed at install time** | See "Primitive layer" below. |
| Routing | TanStack Router | Typed route and search params; the selected month lives in the URL (`?m=YYYY-MM`). |
| Drag and drop | `@dnd-kit` | Pointer, touch and keyboard sensors for the planning editor. |
| Tables | TanStack Table | Transactions list. |
| Charts (time series) | Recharts, planned | Needed for wealth evolution; not installed by this decision. |
| Sankey | `d3-sankey`, kept | Existing layout logic in `src/domain/budget/chart-layout.ts` is retained. |

### Primitive layer

shadcn/ui supports more than one primitive layer. The official
[changelog](https://ui.shadcn.com/docs/changelog) lists "Base UI as the
Default" under July 2026 and says Radix remains supported. The changelog
excerpt available when this ADR was written did not detail the change, so the
exact installer behavior was not verified. The installer prompt decides: use
the default offered by the current `shadcn` CLI (Base UI if it is the default),
fall back to Radix otherwise, and record the actual choice in this ADR when the
foundation lands. Application code should import from `src/components/ui/*`
only, so swapping the layer stays a local change.

### Charts

Time-series charts are planned with Recharts because it is React-native SVG,
widely used and enough for line and area charts. The TanStack Charts
[comparison page](https://tanstack.com/charts/latest/docs/comparison) reports a
much smaller gzip size than Recharts (about 43 to 50 kB versus about 157 to
172 kB, measured from unreleased workspace source, not release 1.5.0) and
recommends Recharts for a React-native SVG component model. The page makes no
statement about API stability or production readiness, so TanStack Charts is
not adopted now. Revisit when wealth charts are built and bundle size matters.

## Alternatives considered

1. **Radix primitives with custom CSS (status quo, extended).** Keeps full
   control and adds no design system, but repeats the current problem: every
   page styled by hand, no shared scale, high cost to keep things aligned.
   Rejected.
2. **Mantine or MUI.** Complete, themed component sets with charts, dates and
   forms included. They bring their own styling system and visual identity,
   which conflicts with the existing palette and glass look and makes components
   harder to own and modify. Rejected for now; a reasonable fallback if
   maintaining copied components becomes a burden.
3. **React Router v7 instead of TanStack Router.** Larger ecosystem and the
   better fit for full-stack or SSR apps. The
   [PkgPulse comparison](https://www.pkgpulse.com/guides/tanstack-router-vs-react-router-v7-2026)
   argues that TanStack Router is stronger for typed search params and loader
   data in client-side SPAs, with roughly 40 kB versus 32 kB bundle size, and
   recommends React Router for SSR or Remix migrations. Finance is a pure SPA
   and benefits from typed search params, so TanStack Router wins. These figures
   come from a blog and were not independently measured.
4. **Other drag-and-drop libraries** (native HTML5 drag, `react-beautiful-dnd`
   successors). Native drag lacks touch and keyboard support; `@dnd-kit` has
   built-in sensors and accessibility announcements. Not benchmarked further.

## Consequences

Positive:

- One page layout, one spacing and type scale, shared components with
  accessible behavior.
- Components live in the repo, so they can be restyled without upstream
  constraints.
- Month selection in the URL gives reload-safe, shareable state.
- Recharts is available for wealth time series.

Negative and risks:

- Several new dependencies (Tailwind, shadcn tooling, TanStack Router, TanStack
  Table, dnd-kit) and copied component code to maintain.
- Tailwind's preflight resets default element styles; pages are visually broken
  on the feature branch until each page is rebuilt.
- Most UI end-to-end tests need to be rewritten; domain unit tests are
  unaffected.
- The primitive layer (Base UI versus Radix) is a moving target and unconfirmed.
- Bundle size must be measured before and after.

Recovery: no storage format change, so reverting the UI pull request restores
the previous interface.

## Source reliability

- shadcn/ui changelog: official source, read for this ADR. The July 2026 Base UI
  default entry is confirmed there; details of the change are not.
- TanStack Charts comparison: official, but bundle numbers come from unreleased
  source and the page says nothing about stability. Unverified for production
  use.
- PkgPulse router comparison: third-party blog. Download counts and bundle
  sizes are its own claims, not independently verified.
- [dualite.dev UI library roundup](https://dualite.dev/blogs/best-ui-component-libraries):
  the page content fetched for this ADR did not contain substantive claims about
  shadcn/ui, Mantine, MUI or Radix (only a title and description), so it is
  listed as a reference but no claim in this ADR relies on it. Could not verify.
