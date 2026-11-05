import { useState } from 'react'
import { MoreHorizontal, Plus, Search, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import { ASSISTANT_NAME, chatActions, groupChats, useChats } from './chat-store'

/** Long-term chat history, grouped by recency. */
export function HistoryPanel({ onPick }: { onPick?: () => void }) {
  const { conversations, activeId } = useChats()
  const [query, setQuery] = useState('')
  const filtered = conversations.filter((c) => c.title.toLowerCase().includes(query.toLowerCase()))
  const groups = groupChats(filtered)

  return (
    <div className="flex h-full flex-col gap-3 p-3">
      <Button
        variant="outline"
        className="justify-start"
        onClick={() => {
          chatActions.newChat()
          onPick?.()
        }}
      >
        <Plus /> New chat with {ASSISTANT_NAME}
      </Button>
      <div className="relative">
        <Search className="text-muted-foreground absolute top-1/2 left-2.5 size-4 -translate-y-1/2" />
        <Input className="pl-8" placeholder="Search chats" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search chats" />
      </div>

      <nav className="-mx-1 flex-1 space-y-4 overflow-y-auto px-1">
        {groups.length === 0 && <p className="text-muted-foreground px-2 text-sm">No chats found.</p>}
        {groups.map((g) => (
          <section key={g.label}>
            <h3 className="text-muted-foreground px-2 pb-1 text-xs font-medium">{g.label}</h3>
            <ul className="space-y-0.5">
              {g.items.map((c) => (
                <li key={c.id} className={cn('group hover:bg-accent flex items-center rounded-md', c.id === activeId && 'bg-accent')}>
                  <button
                    className="min-w-0 flex-1 truncate px-2 py-1.5 text-left text-sm"
                    onClick={() => {
                      chatActions.open(c.id)
                      onPick?.()
                    }}
                  >
                    {c.title}
                  </button>
                  <DropdownMenu>
                    <DropdownMenuTrigger render={<Button size="icon-xs" variant="ghost" className="mr-1 opacity-0 group-hover:opacity-100 focus-visible:opacity-100 data-popup-open:opacity-100" aria-label={`Options for ${c.title}`} />}>
                      <MoreHorizontal />
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem variant="destructive" onClick={() => chatActions.remove(c.id)}>
                        <Trash2 /> Delete chat
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </nav>
    </div>
  )
}
