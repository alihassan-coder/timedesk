import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router'
import { useChat } from '@ai-sdk/react'
import { DefaultChatTransport, type UIMessage } from 'ai'
import { History, KeyRound, Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet'
import { ASSISTANT_NAME, chatActions, textOf, useChats } from '@/features/assistant/chat-store'
import { Composer } from '@/features/assistant/composer'
import { HistoryPanel } from '@/features/assistant/history-panel'
import { MessageView } from '@/features/assistant/message-view'
import { MemoryPopover, ToolsPopover } from '@/features/assistant/popovers'
import { loadStore } from '@/data/store'
import { API_URL } from '@/lib/auth-client'
import { useAi } from '@/lib/ai/server'
import { useAiPrefs } from '@/lib/ai/settings'

const SUGGESTIONS = [
  'Plan my day around what is due',
  'Add a task: review pull requests tomorrow, high priority',
  'How much time did I track this week?',
  'Start a timer on my first task',
]

/** The server answers errors as {"error": "..."}; show just the message. */
function friendly(err: Error): string {
  try {
    const parsed = JSON.parse(err.message) as { error?: string }
    if (parsed.error) return parsed.error
  } catch {
    // not JSON
  }
  return err.message || 'Something went wrong. Try again.'
}

export default function AssistantPage() {
  const { conversations, activeId } = useChats()
  const [params] = useSearchParams()
  const deepLink = params.get('chat')
  const [draftId, setDraftId] = useState(() => crypto.randomUUID())
  const [historyOpen, setHistoryOpen] = useState(false)

  useEffect(() => {
    if (deepLink) chatActions.open(deepLink)
  }, [deepLink])

  // After a chat is deliberately started anew, give it a fresh id.
  useEffect(() => {
    if (activeId === null) setDraftId(crypto.randomUUID())
  }, [activeId])

  const active = conversations.find((c) => c.id === activeId)
  const chatId = active?.id ?? draftId

  return (
    <div className="flex h-[calc(100svh-3.5rem)]">
      <aside className="bg-muted/30 hidden w-72 shrink-0 border-r md:block">
        <HistoryPanel />
      </aside>

      <section className="flex min-w-0 flex-1 flex-col">
        <div className="flex h-12 shrink-0 items-center gap-2 px-4">
          <Sheet open={historyOpen} onOpenChange={setHistoryOpen}>
            <SheetTrigger render={<Button size="icon-sm" variant="ghost" className="md:hidden" aria-label="Chat history" />}>
              <History />
            </SheetTrigger>
            <SheetContent side="left" className="w-80 p-0">
              <SheetHeader className="sr-only">
                <SheetTitle>Chat history</SheetTitle>
              </SheetHeader>
              <HistoryPanel onPick={() => setHistoryOpen(false)} />
            </SheetContent>
          </Sheet>
          <h1 className="min-w-0 flex-1 truncate text-sm font-medium">{active?.title ?? `New chat with ${ASSISTANT_NAME}`}</h1>
          <MemoryPopover />
          <ToolsPopover />
        </div>

        {active && !active.loaded ? (
          <p className="text-muted-foreground flex flex-1 items-center justify-center text-sm">Loading chat...</p>
        ) : (
          <ChatView key={chatId} chatId={chatId} initial={active?.messages ?? []} />
        )}
      </section>
    </div>
  )
}

function ChatView({ chatId, initial }: { chatId: string; initial: UIMessage[] }) {
  const ai = useAi()
  const prefs = useAiPrefs()
  const [voiceMode, setVoiceMode] = useState(false)
  const endRef = useRef<HTMLDivElement>(null)

  const transport = useMemo(() => new DefaultChatTransport({ api: API_URL + '/v1/assistant/chat', credentials: 'include' }), [])

  const { messages, sendMessage, status, stop, error } = useChat({ id: chatId, messages: initial, transport })
  const busy = status === 'submitted' || status === 'streaming'
  const hasKey = ai.hasKey

  // Keep the newest message in view.
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' })
  }, [messages, status])

  // When an answer finishes: save the chat, refresh app data if tools changed it, read it aloud in voice mode.
  const wasBusy = useRef(false)
  useEffect(() => {
    if (busy) {
      wasBusy.current = true
      return
    }
    if (!wasBusy.current) return
    wasBusy.current = false
    chatActions.save(chatId, messages)
    const last = messages[messages.length - 1]
    if (last?.role !== 'assistant') return
    if (last.parts.some((p) => p.type.startsWith('tool-'))) void loadStore()
    if (voiceMode && prefs.voice.speakReplies && 'speechSynthesis' in window) {
      const u = new SpeechSynthesisUtterance(textOf(last))
      u.lang = prefs.voice.lang
      u.rate = prefs.voice.rate
      window.speechSynthesis.cancel()
      window.speechSynthesis.speak(u)
    }
  }, [busy, chatId, messages, voiceMode, prefs.voice])

  const send = (text: string) => {
    window.speechSynthesis?.cancel()
    // The model choice travels with each message, so switching models mid-chat just works.
    void sendMessage({ text }, { body: { provider: ai.current?.provider, model: ai.current?.model } })
  }

  const composer = (
    <Composer
      onSend={send}
      onStop={() => void stop()}
      busy={busy}
      disabled={!hasKey}
      voiceMode={voiceMode}
      onVoiceMode={setVoiceMode}
      className="mx-auto w-full max-w-3xl"
    />
  )

  const keyBanner = !hasKey && ai.loaded && (
    <div className="bg-muted/50 mx-auto mb-2 flex w-full max-w-3xl items-center gap-3 rounded-lg border px-4 py-2 text-sm">
      <KeyRound className="size-4 shrink-0" />
      <span className="flex-1">Add an API key to chat with {ASSISTANT_NAME}. The models you can pick depend on the keys you add.</span>
      <Button size="sm" render={<Link to="/settings?tab=ai" />}>
        AI settings
      </Button>
    </div>
  )

  if (messages.length === 0) {
    return (
      <>
        {keyBanner}
        <div className="flex flex-1 flex-col items-center justify-center gap-6 px-4 pb-16">
          <div className="flex items-center gap-3">
            <div className="bg-primary text-primary-foreground flex size-10 items-center justify-center rounded-xl">
              <Sparkles className="size-5" />
            </div>
            <h2 className="text-3xl font-semibold tracking-tight">How can {ASSISTANT_NAME} help?</h2>
          </div>
          {composer}
          <div className="flex max-w-3xl flex-wrap justify-center gap-2">
            {SUGGESTIONS.map((s) => (
              <Button key={s} size="sm" variant="outline" className="rounded-full" disabled={!hasKey} onClick={() => send(s)}>
                {s}
              </Button>
            ))}
          </div>
        </div>
      </>
    )
  }

  return (
    <>
      {keyBanner}
      <div className="flex-1 overflow-y-auto px-4">
        <div className="mx-auto w-full max-w-3xl space-y-8 py-6">
          {messages.map((m) => (
            <MessageView key={m.id} message={m} />
          ))}
          {status === 'submitted' && <p className="text-muted-foreground text-sm">{ASSISTANT_NAME} is thinking...</p>}
          {error && (
            <p role="alert" className="border-destructive/30 bg-destructive/10 text-destructive rounded-md border px-3 py-2 text-sm">
              {friendly(error)}
            </p>
          )}
          <div ref={endRef} />
        </div>
      </div>
      <div className="px-4 pt-2 pb-4">
        {composer}
        <p className="text-muted-foreground mt-2 text-center text-xs">{ASSISTANT_NAME} can make mistakes. Check important changes.</p>
      </div>
    </>
  )
}
