/**
 * The one horizontal container of the app. Page, the shell banners and the
 * footer all use it, so every title and card shares the same left edge.
 * Width and gutter come from --page-max-width and --page-gutter (index.css).
 */
export const pageContainerClass =
  'mx-auto w-full max-w-(--page-max-width) px-(--page-gutter)'
