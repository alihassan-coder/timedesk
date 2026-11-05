import { useEffect, useRef, useState } from 'react'
import { Hash, Send } from 'lucide-react'
import { PageHeader } from '@/components/page-header'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { channels, team } from '@/data/seed'
import { actions, useStore } from '@/data/store'
import { clock } from '@/lib/format'
import { cn } from '@/lib/utils'

export default function ChatPage() {
  const { messages } = useStore()
  const [channelId, setChannelId] = useState('general')
  const [text, setText] = useState('')
  const endRef = useRef<HTMLDivElement>(null)
  const shown = messages.filter((m) => m.channelId === channelId)

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' })
  }, [shown.length, channelId])

  return (
    <>
      <PageHeader title="Chat" description="Talk with your team. Project channels keep conversations next to the work." />
      <div className="grid h-[65vh] min-h-96 overflow-hidden rounded-lg border md:grid-cols-[220px_1fr]">
        <nav className="bg-muted/30 border-b p-2 md:border-r md:border-b-0">
          <p className="text-muted-foreground px-2 py-1.5 text-xs font-medium">Channels</p>
          {channels.map((c) => (
            <button
              key={c.id}
              onClick={() => setChannelId(c.id)}
              className={cn(
                'hover:bg-accent flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm',
                c.id === channelId && 'bg-accent font-medium',
              )}
            >
              <Hash className="size-4" /> {c.name}
            </button>
          ))}
        </nav>

        <div className="flex min-h-0 flex-col">
          <div className="flex-1 space-y-4 overflow-y-auto p-4">
            {shown.map((m) => {
              const user = team.find((u) => u.id === m.userId)
              return (
                <div key={m.id} className="flex gap-3">
                  <Avatar className="size-8">
                    <AvatarFallback>{user?.initials}</AvatarFallback>
                  </Avatar>
                  <div>
                    <p className="text-sm">
                      <span className="font-medium">{user?.name}</span>{' '}
                      <span className="text-muted-foreground text-xs">{clock(m.at)}</span>
                    </p>
                    <p className="text-sm">{m.text}</p>
                  </div>
                </div>
              )
            })}
            <div ref={endRef} />
          </div>
          <form
            className="flex gap-2 border-t p-3"
            onSubmit={(e) => {
              e.preventDefault()
              actions.sendMessage(channelId, text)
              setText('')
            }}
          >
            <Input value={text} onChange={(e) => setText(e.target.value)} placeholder={`Message #${channels.find((c) => c.id === channelId)?.name}`} />
            <Button type="submit" size="icon" aria-label="Send message" disabled={!text.trim()}>
              <Send />
            </Button>
          </form>
        </div>
      </div>
    </>
  )
}
