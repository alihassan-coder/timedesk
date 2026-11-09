import { useRef, useState } from 'react'
import { ArrowUp, AudioLines, Mic, MicOff, Square } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import type { ProviderId } from '@/lib/ai/providers'
import { useAi } from '@/lib/ai/server'
import { useAiPrefs } from '@/lib/ai/settings'
import { cn } from '@/lib/utils'
import { ASSISTANT_NAME } from './chat-store'

/** Minimal typing for the browser speech API (Chrome and Edge). */
interface SpeechRecognitionLike {
  lang: string
  interimResults: boolean
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null
  onend: (() => void) | null
  onerror: ((e: { error?: string }) => void) | null
  start(): void
  stop(): void
}
function createRecognition(lang: string): SpeechRecognitionLike | null {
  const w = window as unknown as {
    SpeechRecognition?: new () => SpeechRecognitionLike
    webkitSpeechRecognition?: new () => SpeechRecognitionLike
  }
  const Ctor = w.SpeechRecognition ?? w.webkitSpeechRecognition
  if (!Ctor) return null
  const r = new Ctor()
  r.lang = lang
  r.interimResults = false
  return r
}

export function Composer({
  onSend,
  onStop,
  busy,
  disabled,
  voiceMode,
  onVoiceMode,
  className,
}: {
  onSend: (text: string) => void
  onStop: () => void
  busy: boolean
  disabled: boolean
  voiceMode: boolean
  onVoiceMode: (on: boolean) => void
  className?: string
}) {
  const ai = useAi()
  const prefs = useAiPrefs()
  const [text, setText] = useState('')
  const [listening, setListening] = useState(false)
  const [note, setNote] = useState('')
  const recRef = useRef<SpeechRecognitionLike | null>(null)

  const value = ai.current ? `${ai.current.provider}:${ai.current.model}` : ''
  const items = ai.providers.flatMap((g) => g.models.map((m) => ({ value: `${g.provider}:${m}`, label: m })))

  function submit(content = text) {
    const t = content.trim()
    if (!t || disabled || busy) return
    onSend(t)
    setText('')
  }

  function toggleMic() {
    setNote('')
    if (listening) {
      recRef.current?.stop()
      return
    }
    const rec = createRecognition(prefs.voice.lang)
    if (!rec) {
      setNote('This browser has no speech recognition. Use Chrome or Edge, or the desktop app.')
      return
    }
    rec.onresult = (e) => {
      const heard = e.results[0][0].transcript
      if (voiceMode && prefs.voice.autoSend) submit(heard)
      else setText((prev) => (prev ? `${prev} ${heard}` : heard))
    }
    rec.onend = () => setListening(false)
    rec.onerror = (e) => {
      setListening(false)
      // "no-speech" and "aborted" are normal endings; anything else deserves a word.
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') setNote('Microphone access is blocked. Allow it in your browser or system settings.')
      else if (e.error === 'audio-capture') setNote('No microphone was found.')
      else if (e.error === 'network') setNote('Speech recognition needs an internet connection.')
      else if (e.error && e.error !== 'no-speech' && e.error !== 'aborted') setNote('Speech recognition stopped. Try again.')
    }
    recRef.current = rec
    rec.start()
    setListening(true)
  }

  if (voiceMode) {
    return (
      <div className={cn('flex flex-col items-center gap-3 rounded-2xl border p-6', className)}>
        <button
          onClick={toggleMic}
          disabled={disabled || busy}
          aria-label={listening ? 'Stop listening' : 'Start listening'}
          className={cn(
            'bg-primary text-primary-foreground flex size-20 items-center justify-center rounded-full transition disabled:opacity-50',
            listening && 'animate-pulse ring-primary/30 ring-8',
          )}
        >
          {listening ? <AudioLines className="size-8" /> : <Mic className="size-8" />}
        </button>
        <p className="text-muted-foreground text-sm">{note || (busy ? `${ASSISTANT_NAME} is thinking...` : listening ? 'Listening. Speak now.' : `Tap to talk to ${ASSISTANT_NAME}`)}</p>
        <Button size="sm" variant="outline" onClick={() => onVoiceMode(false)}>
          Back to typing
        </Button>
      </div>
    )
  }

  return (
    <div className={cn('bg-card focus-within:ring-ring/40 rounded-2xl border shadow-xs focus-within:ring-3', className)}>
      <Textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault()
            submit()
          }
        }}
        rows={2}
        placeholder={listening ? 'Listening...' : `Ask ${ASSISTANT_NAME} to plan, track or change anything`}
        className="max-h-48 min-h-14 resize-none border-0 bg-transparent px-4 pt-3 shadow-none focus-visible:ring-0 dark:bg-transparent"
      />
      <div className="flex items-center gap-2 p-2">
        <Select
          value={value}
          items={items}
          disabled={ai.providers.length === 0}
          onValueChange={(v) => {
            if (!v) return
            const [p, ...rest] = v.split(':')
            ai.select(p as ProviderId, rest.join(':'))
          }}
        >
          <SelectTrigger size="sm" className="text-muted-foreground hover:text-foreground max-w-64 min-w-0 border-0 shadow-none" aria-label="Model">
            <SelectValue placeholder="Add an API key" />
          </SelectTrigger>
          {/* Wider than the trigger so long model names fit, opens upward, and scrolls when the list is long. */}
          <SelectContent side="top" align="start" alignItemWithTrigger={false} className="max-h-80 w-auto max-w-[min(26rem,92vw)] min-w-72">
            {ai.providers.map((g) => (
              <SelectGroup key={g.provider}>
                <SelectLabel className="px-2 pt-2 pb-1 text-[11px] font-medium tracking-wide uppercase">{g.name}</SelectLabel>
                {g.models.map((model) => (
                  <SelectItem key={model} value={`${g.provider}:${model}`} className="py-1.5 pr-8 pl-2">
                    {model}
                  </SelectItem>
                ))}
              </SelectGroup>
            ))}
          </SelectContent>
        </Select>
        {note && <span className="text-muted-foreground text-xs">{note}</span>}
        <div className="ml-auto flex items-center gap-1">
          <Button size="icon" variant={listening ? 'destructive' : 'ghost'} aria-label={listening ? 'Stop dictation' : 'Dictate'} onClick={toggleMic}>
            {listening ? <MicOff /> : <Mic />}
          </Button>
          <Button size="icon" variant="ghost" aria-label="Voice mode" onClick={() => onVoiceMode(true)}>
            <AudioLines />
          </Button>
          {busy ? (
            <Button size="icon" className="rounded-full" aria-label="Stop" onClick={onStop}>
              <Square />
            </Button>
          ) : (
            <Button size="icon" className="rounded-full" aria-label="Send message" disabled={disabled || !text.trim()} onClick={() => submit()}>
              <ArrowUp />
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}
