import { useState } from 'react'
import { Brain, Wrench } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverHeader, PopoverTitle, PopoverTrigger } from '@/components/ui/popover'
import { memory } from '@/lib/ai/memory'
import { TOOL_LABELS } from '@/lib/ai/tools'
import { ASSISTANT_NAME } from './chat-store'

export function MemoryPopover() {
  const [items, setItems] = useState(() => memory.list())
  return (
    <Popover onOpenChange={(open) => open && setItems(memory.list())}>
      <PopoverTrigger render={<Button size="sm" variant="ghost" />}>
        <Brain /> Memory
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80">
        <PopoverHeader>
          <PopoverTitle>What {ASSISTANT_NAME} remembers</PopoverTitle>
        </PopoverHeader>
        {items.length === 0 ? (
          <p className="text-muted-foreground text-sm">Nothing yet. Tell it things like "I work 9 to 5" and it will remember.</p>
        ) : (
          <ul className="space-y-2 text-sm">
            {items.map((m) => (
              <li key={m.id} className="flex items-start justify-between gap-2">
                <span>{m.text}</span>
                <Button size="xs" variant="ghost" onClick={() => { memory.remove(m.id); setItems(memory.list()) }}>
                  Forget
                </Button>
              </li>
            ))}
          </ul>
        )}
        <p className="text-muted-foreground mt-3 text-xs">Long-term memory will use mem0 stored in your Neon database.</p>
      </PopoverContent>
    </Popover>
  )
}

export function ToolsPopover() {
  const labels = Object.values(TOOL_LABELS)
  return (
    <Popover>
      <PopoverTrigger render={<Button size="sm" variant="ghost" />}>
        <Wrench /> Tools
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72">
        <PopoverHeader>
          <PopoverTitle>What {ASSISTANT_NAME} can do</PopoverTitle>
        </PopoverHeader>
        <ul className="grid gap-1.5 text-sm">
          {labels.map((l) => (
            <li key={l} className="flex items-center gap-2">
              <span className="bg-primary size-1.5 rounded-full" /> {l}
            </li>
          ))}
        </ul>
      </PopoverContent>
    </Popover>
  )
}
