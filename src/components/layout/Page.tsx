import type { ComponentProps } from 'react'
import { cn } from '@/lib/utils'
import { pageContainerClass } from './container'

interface PageProps extends ComponentProps<'div'> {
  /**
   * Landmark element. Keep the default `main` for pages that no longer render
   * their own <main>. Legacy pages (not migrated yet) still render one and use
   * `as="div"` so the document keeps a single main landmark.
   */
  as?: 'main' | 'div'
}

/**
 * Single page container for every route: shared max width, gutters and
 * vertical rhythm. Children are separated by a `gap-6` stack.
 */
export function Page({
  as: Tag = 'main',
  className,
  children,
  ...props
}: PageProps) {
  return (
    <Tag
      className={cn(
        pageContainerClass,
        'flex min-w-0 flex-1 flex-col gap-6 py-6 md:py-8',
        className,
      )}
      {...props}
    >
      {children}
    </Tag>
  )
}
