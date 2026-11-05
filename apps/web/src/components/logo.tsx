import { cn } from '@/lib/utils'

/** timedesk mark: a tile in the accent colour holding a dial that is three-quarters drawn, with one hand. */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={cn('size-8', className)} role="img" aria-label="timedesk">
      <rect width="32" height="32" rx="9" className="fill-primary" />
      <circle
        cx="16"
        cy="16"
        r="8"
        fill="none"
        className="stroke-primary-foreground"
        strokeWidth="3"
        strokeLinecap="round"
        strokeDasharray="37.7 12.57"
        transform="rotate(-90 16 16)"
      />
      <path d="M16 16V10.5" className="stroke-primary-foreground" strokeWidth="3" strokeLinecap="round" />
    </svg>
  )
}
