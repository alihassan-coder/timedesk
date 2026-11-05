import { useEffect, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router'
import { History, KeyRound, Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet'
import { ASSISTANT_NAME, chatActions, useChats } from '@/features/assistant/chat-store'
import { Composer } from '@/features/assistant/composer'
import { HistoryPanel } from '@/features/assistant/history-panel'
import { MessageView } from '@/features/assistant/message-view'
import { MemoryPopover, ToolsPopover } from '@/features/assistant/popovers'
import { availableModels, useAiSettings } from '@/lib/ai/settings'

const SUGGESTIONS = [
  'Plan my day around what is due',
  'Add a task: review pull requests tomorrow, high priority',
  'How much time did I track this week?',
  'Start a timer on the pricing table task',
]

export default function AssistantPage() {
  const ai = useAiSettings()
  const hasKey = availableModels(ai).length > 0
  const { conversations, activeId } = useChats()
  const active = conversations.find((c) => c.id === activeId)
  const [voiceMode, setVoiceMode] = useState(false)
  const [historyOpen, setHistoryOpen] = useState(false)
  const endRef = useRef<HTMLDivElement>(null)
  const [params] = useSearchParams()
  const deepLink = params.get('chat')

  useEffect(() => {
    if (deepLink) chatActions.open(deepLink)
  }, [deepLink])

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' })
  }, [active?.messages.length, activeId])

  function send(text: string) {
    const id = chatActions.addUserMessage(text)
    // Interface preview only: the real agent (model + tools + memory) is wired in the next step.
    chatActions.addAssistantMessage(
      id,
      `Interface preview: ${ASSISTANT_NAME} is not connected to a model yet. Next step wires this chat to your selected model, the task and timer tools, and memory.`,
    )
  }

  const composer = (
    <Composer onSend={send} disabled={!hasKey} voiceMode={voiceMode} onVoiceMode={setVoiceMode} className="mx-auto w-full max-w-3xl" />
  )

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

        {!hasKey && (
          <div className="bg-muted/50 mx-auto mb-2 flex w-full max-w-3xl items-center gap-3 rounded-lg border px-4 py-2 text-sm">
            <KeyRound className="size-4 shrink-0" />
            <span className="flex-1">Add an API key to chat with {ASSISTANT_NAME}. Models depend on the keys you add.</span>
            <Button size="sm" render={<Link to="/settings?tab=ai" />}>
              AI settings
            </Button>
          </div>
        )}

        {!active ? (
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
        ) : (
          <>
            <div className="flex-1 overflow-y-auto px-4">
              <div className="mx-auto w-full max-w-3xl space-y-8 py-6">
                {active.messages.map((m) => (
                  <MessageView key={m.id} message={m} />
                ))}
                <div ref={endRef} />
              </div>
            </div>
            <div className="px-4 pt-2 pb-4">
              {composer}
              <p className="text-muted-foreground mt-2 text-center text-xs">{ASSISTANT_NAME} can make mistakes. Check important changes.</p>
            </div>
          </>
        )}
      </section>
    </div>
  )
}
