import { createContext, memo, useContext, useState, type FormEvent } from 'react'
import { Check, CircleHelp, Loader2, ShieldAlert, Sparkles, X } from 'lucide-react'
import type { UIMessage } from 'ai'
import { Markdown } from '@/components/markdown'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { TOOL_LABELS, TOOL_PENDING } from './tool-labels'

/**
 * What the chat can do with a message: answer an approval request, or answer a question Tempo asked. Passed through
 * context so MessageView stays memoised (it only re-renders when its own message changes).
 */
export interface ChatHandlers {
  approve: (approvalId: string, approved: boolean) => void
  answer: (toolCallId: string, answer: string) => void
  /** True while an answer streams: the buttons wait. */
  busy: boolean
}
export const ChatHandlersContext = createContext<ChatHandlers>({ approve: () => undefined, answer: () => undefined, busy: false })

interface ToolPart {
  type: string
  toolCallId: string
  state?: string
  input?: Record<string, unknown>
  output?: unknown
  errorText?: string
  approval?: { id: string; approved?: boolean; reason?: string; requestReason?: string; isAutomatic?: boolean }
}

/**
 * Claude-style: your messages in a soft bubble, the assistant's answer as plain text on the page.
 * Memoised: while one answer streams, the earlier messages keep the same object and skip parsing markdown again.
 */
export const MessageView = memo(function MessageView({ message }: { message: UIMessage }) {
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
          if (part.type === 'text') return part.text ? <Markdown key={i}>{part.text}</Markdown> : null
          if (part.type.startsWith('tool-')) return <ToolView key={i} part={part as unknown as ToolPart} />
          return null
        })}
      </div>
    </div>
  )
})

const errorOf = (output: unknown): string | null =>
  output && typeof output === 'object' && 'error' in output && typeof (output as { error: unknown }).error === 'string' ? (output as { error: string }).error : null

function ToolView({ part }: { part: ToolPart }) {
  const name = part.type.slice('tool-'.length)
  if (name === 'ask_user') return <AskUser part={part} />
  const label = TOOL_LABELS[name] ?? name
  const state = part.state

  if (state === 'approval-requested' && !part.approval?.isAutomatic) return <ApprovalCard part={part} name={name} />

  const softError = state === 'output-available' ? errorOf(part.output) : null
  const failed = state === 'output-error' || !!softError
  const denied = state === 'output-denied' || (state === 'approval-responded' && part.approval?.approved === false)
  const done = state === 'output-available' && !softError
  const text = denied
    ? `You said no: ${TOOL_PENDING[name] ?? label}`
    : failed
      ? `Could not do it: ${TOOL_PENDING[name] ?? label}`
      : state === 'approval-responded'
        ? `Approved: ${TOOL_PENDING[name] ?? label}`
        : label
  return (
    <div className="space-y-1">
      <div className="text-muted-foreground flex w-fit items-center gap-2 rounded-md border px-2.5 py-1 text-xs">
        {denied || failed ? <X className="text-destructive size-3.5" /> : done ? <Check className="text-primary size-3.5" /> : <Loader2 className="size-3.5 animate-spin" />}
        {text}
      </div>
      {failed && (softError || part.errorText) && <p className="text-destructive pl-1 text-xs">{softError ?? part.errorText}</p>}
    </div>
  )
}

/** Tempo wants to do something that cannot be undone (or that changes your Google Calendar): you decide. */
function ApprovalCard({ part, name }: { part: ToolPart; name: string }) {
  const { approve, busy } = useContext(ChatHandlersContext)
  const [sent, setSent] = useState(false)
  const id = part.approval?.id
  const what = part.approval?.requestReason || TOOL_PENDING[name] || TOOL_LABELS[name] || name
  const decide = (ok: boolean) => {
    if (!id || sent) return
    setSent(true)
    approve(id, ok)
  }
  return (
    <div role="group" aria-label="Tempo asks for your approval" className="border-primary/40 bg-primary/5 w-full max-w-md space-y-3 rounded-xl border p-3">
      <div className="flex items-start gap-2">
        <ShieldAlert className="text-primary mt-0.5 size-4 shrink-0" />
        <div className="space-y-0.5">
          <p className="text-sm font-medium">Tempo wants to: {what}</p>
          <p className="text-muted-foreground text-xs">Nothing happens until you choose.</p>
        </div>
      </div>
      <div className="flex gap-2">
        <Button size="sm" onClick={() => decide(true)} disabled={sent || busy || !id}>
          Allow
        </Button>
        <Button size="sm" variant="outline" onClick={() => decide(false)} disabled={sent || busy || !id}>
          Don&apos;t allow
        </Button>
      </div>
    </div>
  )
}

/** Tempo asked a question (which task did you mean? which day?). Pick an option or type an answer. */
function AskUser({ part }: { part: ToolPart }) {
  const { answer, busy } = useContext(ChatHandlersContext)
  const [text, setText] = useState('')
  const [sent, setSent] = useState(false)
  const question = typeof part.input?.question === 'string' ? part.input.question : ''
  const options = Array.isArray(part.input?.options) ? (part.input.options as unknown[]).filter((o): o is string => typeof o === 'string').slice(0, 8) : []
  const answered = part.state === 'output-available'
  const reply = (value: string) => {
    const v = value.trim()
    if (!v || sent) return
    setSent(true)
    answer(part.toolCallId, v)
  }
  if (part.state === 'input-streaming') return <p className="text-muted-foreground text-xs">Tempo is asking you something...</p>
  return (
    <div role="group" aria-label="Tempo asks you" className="w-full max-w-md space-y-3 rounded-xl border p-3">
      <p className="flex items-start gap-2 text-sm font-medium">
        <CircleHelp className="text-primary mt-0.5 size-4 shrink-0" /> {question}
      </p>
      {answered ? (
        <p className="text-muted-foreground text-xs">You answered: {String((part.output as { answer?: unknown })?.answer ?? part.output)}</p>
      ) : (
        <>
          {options.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {options.map((o) => (
                <Button key={o} size="sm" variant="outline" disabled={sent || busy} onClick={() => reply(o)}>
                  {o}
                </Button>
              ))}
            </div>
          )}
          <form
            className="flex gap-2"
            onSubmit={(e: FormEvent) => {
              e.preventDefault()
              reply(text)
            }}
          >
            <Input value={text} onChange={(e) => setText(e.target.value)} placeholder={options.length ? 'Or type your own answer' : 'Your answer'} aria-label="Your answer" maxLength={500} disabled={sent} />
            <Button type="submit" size="sm" disabled={sent || busy || !text.trim()}>
              Answer
            </Button>
          </form>
        </>
      )}
    </div>
  )
}
