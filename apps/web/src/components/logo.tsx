import { cn } from '@/lib/utils'

/**
 * timedesk mark: a rounded tile in the accent colour with a timer ring (three-quarters drawn)
 * and a check inside it. Time plus todos in one shape.
 * The `!` on the size matters: the sidebar button otherwise forces child SVGs down to 16px.
 */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={cn('size-8!', className)} role="img" aria-label="timedesk">
      <rect width="32" height="32" rx="9" className="fill-primary" />
      <circle
        cx="16"
        cy="16"
        r="9"
        fill="none"
        className="stroke-primary-foreground"
        strokeWidth="2.6"
        strokeLinecap="round"
        strokeDasharray="42.4 14.1"
        transform="rotate(-90 16 16)"
      />
      <path
        d="M12.3 16.4l2.7 2.7 5.2-5.8"
        fill="none"
        className="stroke-primary-foreground"
        strokeWidth="2.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

export function Wordmark({ className }: { className?: string }) {
  return <span className={cn('text-lg font-semibold tracking-tight', className)}>timedesk</span>
}
