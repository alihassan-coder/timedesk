import { Check, Sparkles } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { ChatMessage } from './chat-store'

/** Claude-style: your messages in a soft bubble, the assistant's answer as plain text on the page. */
export function MessageView({ message }: { message: ChatMessage }) {
  if (message.role === 'user') {
    return (
      <div className="flex justify-end">
        <div className="bg-muted max-w-[85%] rounded-2xl px-4 py-2.5 whitespace-pre-wrap">{message.text}</div>
      </div>
    )
  }
  return (
    <div className="flex gap-3">
      <div className="bg-primary text-primary-foreground mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full">
        <Sparkles className="size-3.5" />
      </div>
      <div className="min-w-0 flex-1 space-y-3">
        {message.tools && message.tools.length > 0 && (
          <ul className="space-y-1.5">
            {message.tools.map((t, i) => (
              <li key={i} className={cn('text-muted-foreground flex w-fit items-center gap-2 rounded-md border px-2.5 py-1 text-xs')}>
                <Check className="text-primary size-3.5" /> {t.summary}
              </li>
            ))}
          </ul>
        )}
        <p className="leading-relaxed whitespace-pre-wrap">{message.text}</p>
      </div>
    </div>
  )
}
