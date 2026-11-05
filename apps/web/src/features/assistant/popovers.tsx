import { useState } from 'react'
import { Brain, Wrench } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverHeader, PopoverTitle, PopoverTrigger } from '@/components/ui/popover'
import { forgetMemory, listMemories, useAi, type MemoryItem } from '@/lib/ai/server'
import { ASSISTANT_NAME } from './chat-store'
import { TOOL_LABELS } from './tool-labels'

export function MemoryPopover() {
  const { memoryEnabled } = useAi()
  const [items, setItems] = useState<MemoryItem[] | null>(null)
  const load = () => listMemories().then(setItems).catch(() => setItems([]))
  return (
    <Popover onOpenChange={(open) => open && void load()}>
      <PopoverTrigger render={<Button size="sm" variant="ghost" />}>
        <Brain /> Memory
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80">
        <PopoverHeader>
          <PopoverTitle>What {ASSISTANT_NAME} remembers</PopoverTitle>
        </PopoverHeader>
        {!memoryEnabled ? (
          <p className="text-muted-foreground text-sm">Memory needs an OpenAI API key (used for embeddings). Add one in Settings, AI assistant.</p>
        ) : items === null ? (
          <p className="text-muted-foreground text-sm">Loading...</p>
        ) : items.length === 0 ? (
          <p className="text-muted-foreground text-sm">Nothing yet. Tell {ASSISTANT_NAME} things like "I work 9 to 5" and it will remember.</p>
        ) : (
          <ul className="space-y-2 text-sm">
            {items.map((m) => (
              <li key={m.id} className="flex items-start justify-between gap-2">
                <span>{m.text}</span>
                <Button size="xs" variant="ghost" onClick={async () => { await forgetMemory(m.id); await load() }}>
                  Forget
                </Button>
              </li>
            ))}
          </ul>
        )}
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
