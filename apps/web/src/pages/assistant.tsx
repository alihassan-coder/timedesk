import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router'
import { Brain, KeyRound, Mic, MicOff, Send, Sparkles, Wrench } from 'lucide-react'
import { PageHeader } from '@/components/page-header'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Popover, PopoverContent, PopoverHeader, PopoverTitle, PopoverTrigger } from '@/components/ui/popover'
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { availableModels, aiActions, useAiSettings } from '@/lib/ai/settings'
import { memory } from '@/lib/ai/memory'
import { TOOL_LABELS } from '@/lib/ai/tools'
import { providerName } from '@/lib/ai/providers'
import { profile } from '@/lib/profile'
import { cn } from '@/lib/utils'

interface Message {
  id: string
  role: 'user' | 'assistant'
  text: string
}

const SUGGESTIONS = [
  'Plan my day around what is due',
  'Add a task: review pull requests tomorrow, high priority',
  'How much time did I track this week?',
  'Start a timer on the pricing table task',
]

/** Minimal typing for the browser speech API (Chrome and Edge). */
interface SpeechRecognitionLike {
  lang: string
  interimResults: boolean
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null
  onend: (() => void) | null
  onerror: (() => void) | null
  start(): void
  stop(): void
}
function createRecognition(lang: string): SpeechRecognitionLike | null {
  const w = window as unknown as { SpeechRecognition?: new () => SpeechRecognitionLike; webkitSpeechRecognition?: new () => SpeechRecognitionLike }
  const Ctor = w.SpeechRecognition ?? w.webkitSpeechRecognition
  if (!Ctor) return null
  const r = new Ctor()
  r.lang = lang
  r.interimResults = false
  return r
}

export default function AssistantPage() {
  const ai = useAiSettings()
  const groups = availableModels(ai)
  const hasKey = groups.length > 0
  const [messages, setMessages] = useState<Message[]>([])
  const [text, setText] = useState('')
  const [listening, setListening] = useState(false)
  const [voiceMode, setVoiceMode] = useState(false)
  const recRef = useRef<SpeechRecognitionLike | null>(null)
  const endRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' })
  }, [messages.length])

  const selectedValue = ai.selected ? `${ai.selected.provider}:${ai.selected.model}` : (groups[0] ? `${groups[0].provider.id}:${groups[0].models[0]}` : '')
  const items = groups.flatMap((g) => g.models.map((m) => ({ value: `${g.provider.id}:${m}`, label: `${g.provider.name} · ${m}` })))

  function send(content: string) {
    const t = content.trim()
    if (!t) return
    setMessages((m) => [
      ...m,
      { id: crypto.randomUUID(), role: 'user', text: t },
      {
        id: crypto.randomUUID(),
        role: 'assistant',
        text: 'Interface preview: the agent is not connected yet. Next step wires this box to your selected model, the task and timer tools, and memory.',
      },
    ])
    setText('')
  }

  function toggleMic() {
    if (listening) {
      recRef.current?.stop()
      return
    }
    const rec = createRecognition(ai.voice.lang)
    if (!rec) {
      setMessages((m) => [...m, { id: crypto.randomUUID(), role: 'assistant', text: 'This browser has no speech recognition. Use Chrome or Edge, or the desktop app.' }])
      return
    }
    rec.onresult = (e) => {
      const heard = e.results[0][0].transcript
      if (voiceMode && ai.voice.autoSend) send(heard)
      else setText((prev) => (prev ? `${prev} ${heard}` : heard))
    }
    rec.onend = () => setListening(false)
    rec.onerror = () => setListening(false)
    recRef.current = rec
    rec.start()
    setListening(true)
  }

  return (
    <div className="flex h-[calc(100svh-9rem)] min-h-[28rem] flex-col gap-4">
      <PageHeader
        title="Assistant"
        description="Ask it to manage your tasks, projects, timer and reports."
        actions={
          <>
            <label className="flex items-center gap-2 text-sm">
              <Switch checked={voiceMode} onCheckedChange={setVoiceMode} aria-label="Voice mode" /> Voice mode
            </label>
            <MemoryPopover />
            <ToolsPopover />
          </>
        }
      />

      {!hasKey && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <KeyRound className="size-4" /> Add an API key to start
            </CardTitle>
            <CardDescription>
              Connect OpenAI, Anthropic, Gemini, Groq or xAI Grok. The models you can pick here depend on the keys you add.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button render={<Link to="/settings?tab=ai" />}>Open AI settings</Button>
          </CardContent>
        </Card>
      )}

      <div className="flex-1 space-y-5 overflow-y-auto rounded-lg border p-4">
        {messages.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-4 text-center">
            <div className="bg-primary text-primary-foreground flex size-12 items-center justify-center rounded-xl">
              <Sparkles className="size-6" />
            </div>
            <div>
              <p className="text-lg font-medium">What should we get done?</p>
              <p className="text-muted-foreground text-sm">Try one of these, or type your own.</p>
            </div>
            <div className="flex max-w-xl flex-wrap justify-center gap-2">
              {SUGGESTIONS.map((s) => (
                <Button key={s} size="sm" variant="outline" onClick={() => send(s)}>
                  {s}
                </Button>
              ))}
            </div>
          </div>
        ) : (
          messages.map((m) => (
            <div key={m.id} className={cn('flex gap-3', m.role === 'user' && 'flex-row-reverse')}>
              <Avatar className="size-8 shrink-0">
                <AvatarFallback className={m.role === 'assistant' ? 'bg-primary text-primary-foreground' : ''}>
                  {m.role === 'assistant' ? <Sparkles className="size-4" /> : profile.initials}
                </AvatarFallback>
              </Avatar>
              <div
                className={cn(
                  'max-w-[80%] rounded-2xl px-4 py-2.5 text-sm whitespace-pre-wrap',
                  m.role === 'user' ? 'bg-primary text-primary-foreground' : 'bg-muted',
                )}
              >
                {m.text}
              </div>
            </div>
          ))
        )}
        <div ref={endRef} />
      </div>

      <div className="space-y-2 rounded-xl border p-2">
        <Textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              if (hasKey) send(text)
            }
          }}
          rows={2}
          placeholder={listening ? 'Listening...' : 'Message the assistant. Enter to send, Shift+Enter for a new line.'}
          className="resize-none border-0 shadow-none focus-visible:ring-0"
        />
        <div className="flex flex-wrap items-center gap-2">
          <Select value={selectedValue} items={items} onValueChange={(v) => {
            if (!v) return
            const [p, ...rest] = v.split(':')
            aiActions.select(p as never, rest.join(':'))
          }} disabled={!hasKey}>
            <SelectTrigger size="sm" className="max-w-64" aria-label="Model">
              <SelectValue placeholder="No model: add a key first" />
            </SelectTrigger>
            <SelectContent>
              {groups.map((g) => (
                <SelectGroup key={g.provider.id}>
                  <SelectLabel>{g.provider.name}</SelectLabel>
                  {g.models.map((model) => (
                    <SelectItem key={model} value={`${g.provider.id}:${model}`}>
                      {model}
                    </SelectItem>
                  ))}
                </SelectGroup>
              ))}
            </SelectContent>
          </Select>
          {ai.selected && <Badge variant="secondary">{providerName(ai.selected.provider)}</Badge>}
          <div className="ml-auto flex items-center gap-2">
            <Button
              size="icon"
              variant={listening ? 'destructive' : 'outline'}
              aria-label={listening ? 'Stop listening' : 'Start voice input'}
              onClick={toggleMic}
            >
              {listening ? <MicOff /> : <Mic />}
            </Button>
            <Button size="icon" aria-label="Send message" disabled={!hasKey || !text.trim()} onClick={() => send(text)}>
              <Send />
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}

function MemoryPopover() {
  const [items, setItems] = useState(() => memory.list())
  return (
    <Popover onOpenChange={(open) => open && setItems(memory.list())}>
      <PopoverTrigger render={<Button size="sm" variant="outline" />}>
        <Brain /> Memory
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80">
        <PopoverHeader>
          <PopoverTitle>What it remembers about you</PopoverTitle>
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

function ToolsPopover() {
  const labels = Object.values(TOOL_LABELS)
  return (
    <Popover>
      <PopoverTrigger render={<Button size="sm" variant="outline" />}>
        <Wrench /> Tools ({labels.length})
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72">
        <PopoverHeader>
          <PopoverTitle>What the assistant can do</PopoverTitle>
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
