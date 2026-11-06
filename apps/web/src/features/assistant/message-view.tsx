import { Check, Loader2, Sparkles, X } from 'lucide-react'
import type { UIMessage } from 'ai'
import { Markdown } from '@/components/markdown'
import { TOOL_LABELS } from './tool-labels'

/** Claude-style: your messages in a soft bubble, the assistant's answer as plain text on the page. */
export function MessageView({ message }: { message: UIMessage }) {
  if (message.role === 'user') {
    const text = message.parts.map((p) => (p.type === 'text' ? p.text : '')).join('')
    return (
      <div className="flex justify-end">
        <div className="bg-muted max-w-[85%] rounded-2xl px-4 py-2.5 whitespace-pre-wrap">{text}</div>
      </div>
    )
  }
  return (
    <div className="flex gap-3">
      <div className="bg-primary text-primary-foreground mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full">
        <Sparkles className="size-3.5" />
      </div>
      <div className="min-w-0 flex-1 space-y-3">
        {message.parts.map((part, i) => {
          if (part.type === 'text') {
            return part.text ? <Markdown key={i}>{part.text}</Markdown> : null
          }
          if (part.type.startsWith('tool-')) {
            const name = part.type.slice('tool-'.length)
            const state = (part as { state?: string }).state
            const failed = state === 'output-error'
            const done = state === 'output-available'
            return (
              <div key={i} className="text-muted-foreground flex w-fit items-center gap-2 rounded-md border px-2.5 py-1 text-xs">
                {failed ? <X className="text-destructive size-3.5" /> : done ? <Check className="text-primary size-3.5" /> : <Loader2 className="size-3.5 animate-spin" />}
                {TOOL_LABELS[name] ?? name}
              </div>
            )
          }
          return null
        })}
      </div>
    </div>
  )
}
