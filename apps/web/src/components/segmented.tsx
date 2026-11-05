import type { ReactNode } from 'react'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'

/** Single-choice toggle group (shadcn ToggleGroup) with a plain value API. */
export function Segmented<T extends string>({
  value,
  onChange,
  options,
  size = 'default',
}: {
  value: T
  onChange: (v: T) => void
  options: { value: T; label: ReactNode; ariaLabel?: string }[]
  size?: 'default' | 'sm'
}) {
  return (
    <ToggleGroup
      variant="outline"
      size={size}
      spacing={0}
      value={[value]}
      onValueChange={(v) => v[0] && onChange(v[0] as T)}
    >
      {options.map((o) => (
        <ToggleGroupItem key={o.value} value={o.value} aria-label={o.ariaLabel}>
          {o.label}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  )
}
