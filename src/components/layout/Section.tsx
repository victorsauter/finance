import { useId, type ComponentProps, type ReactNode } from 'react'
import { cn } from '@/lib/utils'
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
} from '@/components/ui/card'

interface SectionProps extends Omit<ComponentProps<typeof Card>, 'title'> {
  title: ReactNode
  description?: ReactNode
  /** Controls aligned to the right of the title. */
  actions?: ReactNode
  /** Classes for the body wrapper (e.g. a grid). */
  contentClassName?: string
}

/**
 * A titled card: the standard block of a page. Renders a labelled region with
 * an h2, optional description and actions, then the body.
 */
export function Section({
  title,
  description,
  actions,
  className,
  contentClassName,
  children,
  ...props
}: SectionProps) {
  const titleId = useId()
  return (
    <Card
      role="region"
      aria-labelledby={titleId}
      className={cn('shadow-card', className)}
      {...props}
    >
      <CardHeader>
        <h2
          id={titleId}
          data-slot="card-title"
          className="font-heading text-base leading-snug font-semibold"
        >
          {title}
        </h2>
        {description && <CardDescription>{description}</CardDescription>}
        {actions && <CardAction>{actions}</CardAction>}
      </CardHeader>
      <CardContent className={cn('min-w-0', contentClassName)}>
        {children}
      </CardContent>
    </Card>
  )
}
