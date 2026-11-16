# Styles

Plain CSS, imported in this order by `src/index.css`.

| File | Holds |
| --- | --- |
| `tokens.css` | Design tokens: colors, spacing, radii, z-index scale, mobile header size, layout gap |
| `base.css` | Reset, typography, focus, `.visually-hidden` |
| `shell.css` | App shell: sidebar, mobile header, dock, global banners |
| `components.css` | Reusable controls: buttons, fields, glass panels |
| `pages.css` | Rules shared by several pages (card headings, `.negative-text`) |
| `budget.css` | Budget page: month toolbar, summary, editor, Sankey chart |
| `transactions.css` | Transactions page and the CSV importer |
| `settings.css` | Backup and account pages (settings cards, danger zone) |
| `responsive.css` | Shell breakpoints only (sidebar, header, dock) and `prefers-*` rules |

## Where a responsive rule goes

1. **Page layout** (columns, card grids): a container query in the page's own
   file. The page reacts to the width it really has, not to the viewport, so the
   sidebar being present or collapsed does not matter. See `.workspace` in
   `budget.css`.
2. **A component of one page** that needs to change on small screens: a
   `@media` block at the end of that page's file.
3. **Shell** (sidebar, mobile header, dock): `responsive.css`.

Keep a page's mobile rules next to its base rules. Do not add page selectors
to `responsive.css`.

## Breakpoints

Custom properties do not work inside media queries, so these are conventions:

| Width | Meaning |
| --- | --- |
| `1180px` | Sidebar collapses to icons |
| `980px` | Toolbar and summary grids lose a column |
| `760px` | Sidebar replaced by the mobile header and dock |
| `480px` | Small phones |
| `62rem` (container) | Budget editor and chart sit side by side |

## Rules of thumb

- Grid tracks use `minmax(0, 1fr)`, and flex or grid children that hold text
  get `min-width: 0`. Otherwise long content widens the page.
- Do not hide overflow to make a bug disappear. `scripts/capture-viewports.mjs`
  reports it.
- Hide text visually with a `visually-hidden` style, never `font-size: 0`, so
  screen readers keep the label.
- Avoid `!important`. Two exceptions are accepted: the `.visually-hidden`
  utility and the `prefers-reduced-motion` reset.
- Use the z-index tokens for anything that overlays the page.

## Checking a change

```bash
npm run dev
node scripts/capture-viewports.mjs http://localhost:5173 captures
```

The script screenshots every page at 10 widths in light and dark, then fails on
horizontal overflow, overlapping cards and content leaving its card.
