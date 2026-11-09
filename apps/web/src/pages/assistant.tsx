import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router'
import { useChat } from '@ai-sdk/react'
import { DefaultChatTransport, lastAssistantMessageIsCompleteWithApprovalResponses, lastAssistantMessageIsCompleteWithToolCalls, type UIMessage } from 'ai'
import { History, KeyRound, RefreshCw, Sparkles, WifiOff } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet'
import { ASSISTANT_NAME, chatActions, textOf, useChats } from '@/features/assistant/chat-store'
import { Composer } from '@/features/assistant/composer'
import { HistoryPanel } from '@/features/assistant/history-panel'
import { ChatHandlersContext, MessageView, type ChatHandlers } from '@/features/assistant/message-view'
import { MemoryPopover, ToolsPopover } from '@/features/assistant/popovers'
import { loadStore } from '@/data/store'
import { TEMPO_PROMPTS, timeZone } from '@/features/assistant/tempo-prompts'
import { API_URL, authHeaders } from '@/lib/auth-client'
import { refreshAi, useAi } from '@/lib/ai/server'
import { useAiPrefs } from '@/lib/ai/settings'

const SUGGESTIONS = [
  TEMPO_PROMPTS.plan,
  TEMPO_PROMPTS.day,
  TEMPO_PROMPTS.week,
  'Add a task: review pull requests tomorrow, high priority',
  'How much time did I track this week?',
  'Start a timer on my first task',
]

/** Prompts already sent automatically, so a re-render (or React's development double run) never sends one twice. */
const autoSent = new Set<string>()

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
  const [params, setParams] = useSearchParams()
  const deepLink = params.get('chat')
  const ask = params.get('ask')
  const [draftId, setDraftId] = useState<string>(() => crypto.randomUUID())
  const [historyOpen, setHistoryOpen] = useState(false)
  /** A question passed in the link (?ask=...), to send in a new chat as soon as the chat is ready. */
  const [pending, setPending] = useState<{ text: string; chatId: string } | null>(null)
  const pendingRef = useRef<{ text: string; chatId: string } | null>(null)

  useEffect(() => {
    if (!ask) return
    const next = { text: ask.slice(0, 500), chatId: crypto.randomUUID() }
    pendingRef.current = next
    setPending(next)
    setDraftId(next.chatId)
    chatActions.newChat()
    setParams({}, { replace: true })
    // A key may have been added elsewhere since this device last looked; check before deciding there is none.
    void refreshAi()
  }, [ask, setParams])

  useEffect(() => {
    if (deepLink) chatActions.open(deepLink)
  }, [deepLink])

  // After a chat is deliberately started anew, give it a fresh id (or the one a pending question is waiting for).
  useEffect(() => {
    if (activeId === null) setDraftId(pendingRef.current?.chatId ?? crypto.randomUUID())
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
          <ChatLoading id={active.id} error={active.loadError} />
        ) : (
          <ChatView
            key={chatId}
            chatId={chatId}
            initial={active?.messages ?? []}
            autoSend={pending?.chatId === chatId ? pending.text : undefined}
            onAutoSent={() => {
              pendingRef.current = null
              setPending(null)
            }}
          />
        )}
      </section>
    </div>
  )
}

/** A chat that could not be opened says so, with a way to try again, instead of "Loading" forever. */
function ChatLoading({ id, error }: { id: string; error?: string }) {
  useEffect(() => {
    if (!error) void chatActions.open(id)
  }, [id, error])
  if (!error) return <p className="text-muted-foreground flex flex-1 items-center justify-center text-sm">Loading chat...</p>
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 text-sm">
      <p className="text-muted-foreground">Could not open this chat. {error}</p>
      <Button size="sm" variant="outline" onClick={() => void chatActions.open(id)}>
        <RefreshCw /> Try again
      </Button>
    </div>
  )
}

/** Has the person just answered one of Tempo's questions (ask_user) in the last message? Then the answer goes out. */
const answeredQuestion = (messages: UIMessage[]) => {
  const last = messages[messages.length - 1]
  return last?.role === 'assistant' && last.parts.some((p) => p.type === 'tool-ask_user' && (p as { state?: string }).state === 'output-available')
}

function ChatView({ chatId, initial, autoSend, onAutoSent }: { chatId: string; initial: UIMessage[]; autoSend?: string; onAutoSent?: () => void }) {
  const ai = useAi()
  const prefs = useAiPrefs()
  const [voiceMode, setVoiceMode] = useState(false)
  const [offline, setOffline] = useState(() => typeof navigator !== 'undefined' && navigator.onLine === false)
  const endRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const on = () => setOffline(false)
    const off = () => setOffline(true)
    window.addEventListener('online', on)
    window.addEventListener('offline', off)
    return () => {
      window.removeEventListener('online', on)
      window.removeEventListener('offline', off)
    }
  }, [])

  // The model and time zone go with every request, also the ones sent automatically after an approval or an answer.
  const current = useRef(ai.current)
  current.current = ai.current
  const voice = useRef({ voiceMode, prefs })
  voice.current = { voiceMode, prefs }
  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: API_URL + '/v1/assistant/chat',
        credentials: 'include',
        headers: () => authHeaders(),
        body: () => ({ provider: current.current?.provider, model: current.current?.model, timeZone: timeZone() }),
      }),
    [],
  )

  const { messages, sendMessage, status, stop, error, regenerate, clearError, addToolApprovalResponse, addToolOutput } = useChat({
    id: chatId,
    messages: initial,
    transport,
    // An approval or an answer to Tempo's question is sent on at once, so Tempo can carry on.
    sendAutomaticallyWhen: ({ messages: m }) => lastAssistantMessageIsCompleteWithApprovalResponses({ messages: m }) || (answeredQuestion(m) && lastAssistantMessageIsCompleteWithToolCalls({ messages: m })),
    // Saved when an answer ends, also when it was stopped, cut off, or this chat was left while Tempo was answering.
    onFinish: ({ messages: all, message: last }) => {
      chatActions.save(chatId, all)
      if (last.role !== 'assistant') return
      if (last.parts.some((p) => p.type.startsWith('tool-'))) void loadStore()
      const { voiceMode: speaking, prefs: p } = voice.current
      if (speaking && p.voice.speakReplies && 'speechSynthesis' in window) {
        // Read the words, not the markdown symbols.
        const u = new SpeechSynthesisUtterance(textOf(last).replace(/[#*_`>|-]+/g, ' '))
        u.lang = p.voice.lang
        u.rate = p.voice.rate
        window.speechSynthesis.cancel()
        window.speechSynthesis.speak(u)
      }
    },
    experimental_throttle: 50,
  })
  const busy = status === 'submitted' || status === 'streaming'
  const hasKey = ai.hasKey

  // Keep the newest message in view, but only when the person is already near the bottom (reading back stays put).
  useEffect(() => {
    const el = endRef.current
    const box = el?.parentElement?.parentElement
    if (!el || !box) return
    if (box.scrollHeight - box.scrollTop - box.clientHeight < 200) el.scrollIntoView({ block: 'end' })
  }, [messages, status])

  // Stop speaking when leaving the chat.
  useEffect(() => () => window.speechSynthesis?.cancel(), [])

  const send = (text: string) => {
    window.speechSynthesis?.cancel()
    void sendMessage({ text })
  }

  const handlers = useMemo<ChatHandlers>(
    () => ({
      approve: (id, approved) => void addToolApprovalResponse({ id, approved, ...(approved ? {} : { reason: 'The user said no.' }) }),
      answer: (toolCallId, answer) => void addToolOutput({ tool: 'ask_user', toolCallId, output: { answer } } as never),
      busy,
    }),
    [addToolApprovalResponse, addToolOutput, busy],
  )

  // Send the question the link brought as soon as a model is available. Without a key it waits, and the banner explains.
  // It goes out on the next tick and the cleanup cancels it, so a mount React throws away (development double run)
  // never sends, and the one that stays sends exactly once.
  useEffect(() => {
    if (!autoSend || !ai.loaded || !hasKey || !ai.current) return
    const timer = setTimeout(() => {
      if (!autoSent.has(chatId)) {
        autoSent.add(chatId)
        send(autoSend)
      }
      onAutoSent?.()
    }, 0)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoSend, ai.loaded, hasKey, chatId])

  const composer = (
    <Composer
      onSend={send}
      onStop={() => void stop()}
      busy={busy}
      disabled={!hasKey || offline}
      voiceMode={voiceMode}
      onVoiceMode={setVoiceMode}
      className="mx-auto w-full max-w-3xl"
    />
  )

  const loadFailed = ai.loadFailed
  const offlineBanner = offline && (
    <div className="mx-auto mb-2 flex w-full max-w-3xl items-center gap-3 rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-2 text-sm text-amber-800 dark:text-amber-300">
      <WifiOff className="size-4 shrink-0" />
      <span className="flex-1">You are offline. {ASSISTANT_NAME} needs a connection; your chats stay here until it is back.</span>
    </div>
  )
  const keysFailedBanner = loadFailed && !offline && (
    <div className="bg-muted/50 mx-auto mb-2 flex w-full max-w-3xl items-center gap-3 rounded-lg border px-4 py-2 text-sm">
      <KeyRound className="size-4 shrink-0" />
      <span className="flex-1">Could not load your AI keys.</span>
      <Button size="sm" variant="outline" onClick={() => void ai.retry()}>
        Retry
      </Button>
    </div>
  )
  const keyBanner = !hasKey && ai.loaded && !loadFailed && !offline && (
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
        {offlineBanner}
        {keysFailedBanner}
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
      {offlineBanner}
      {keysFailedBanner}
      {keyBanner}
      <div className="flex-1 overflow-y-auto px-4">
        <div className="mx-auto w-full max-w-3xl space-y-8 py-6">
          <ChatHandlersContext.Provider value={handlers}>
            {messages.map((m) => (
              <MessageView key={m.id} message={m} />
            ))}
          </ChatHandlersContext.Provider>
          {status === 'submitted' && <p className="text-muted-foreground text-sm">{ASSISTANT_NAME} is thinking...</p>}
          {error && (
            <div role="alert" className="border-destructive/30 bg-destructive/10 text-destructive flex items-center gap-3 rounded-md border px-3 py-2 text-sm">
              <span className="flex-1">{offline ? 'The connection dropped. Try again when you are back online.' : friendly(error)}</span>
              <Button
                size="sm"
                variant="outline"
                disabled={busy || offline}
                onClick={() => {
                  clearError()
                  void regenerate()
                }}
              >
                <RefreshCw /> Try again
              </Button>
            </div>
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
