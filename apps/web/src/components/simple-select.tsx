import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'

export interface Option<T extends string = string> {
  value: T
  label: string
}

/** shadcn Select with a flat options list, so forms stay short. */
export function SimpleSelect<T extends string>({
  value,
  onChange,
  options,
  className,
  size,
}: {
  value: T
  onChange: (v: T) => void
  options: Option<T>[]
  className?: string
  size?: 'sm' | 'default'
}) {
  return (
    <Select value={value} items={options} onValueChange={(v) => v && onChange(v as T)}>
      <SelectTrigger className={className} size={size}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
