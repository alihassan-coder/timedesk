import { useState } from 'react'
import { Check, ExternalLink, Loader2, RefreshCw, Trash2 } from 'lucide-react'
import { Row } from '@/components/setting-row'
import { Segmented } from '@/components/segmented'
import { SimpleSelect } from '@/components/simple-select'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { PROVIDERS, type ProviderId, type ProviderInfo } from '@/lib/ai/providers'
import { forgetMemory, listMemories, removeKey, saveKey, useAi, type MemoryItem } from '@/lib/ai/server'
import { aiActions, useAiPrefs } from '@/lib/ai/settings'
import { ApiError } from '@/lib/api'

export function AiTab() {
  const ai = useAi()
  const prefs = useAiPrefs()
  const options = ai.providers.flatMap((g) => g.models.map((m) => ({ value: `${g.provider}:${m}`, label: `${g.name} · ${m}` })))
  const current = ai.current ? `${ai.current.provider}:${ai.current.model}` : ''
  const [retrying, setRetrying] = useState(false)
  const retry = () => {
    setRetrying(true)
    void ai.retry().finally(() => setRetrying(false))
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>API keys</CardTitle>
          <CardDescription>
            Add the providers you use. Keys are encrypted and stored on the server, and are never sent back to the browser. The assistant only offers
            models from providers that have a key.
          </CardDescription>
        </CardHeader>
        <CardContent className="divide-y">
          {ai.loadFailed ? (
            <div role="alert" className="flex flex-wrap items-center gap-3 py-2 text-sm">
              <span className="text-destructive">Could not load your AI keys. {ai.error}</span>
              <Button size="sm" variant="outline" disabled={retrying} onClick={retry}>
                {retrying ? <Loader2 className="animate-spin" /> : <RefreshCw />} Retry
              </Button>
            </div>
          ) : (
            PROVIDERS.map((p) => (
              <KeyRow key={p.id} provider={p} last4={ai.keys.find((k) => k.provider === p.id)?.last4} modelCount={ai.providers.find((x) => x.provider === p.id)?.models.length} />
            ))
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Default model</CardTitle>
          <CardDescription>Used when you open the assistant. You can switch per message.</CardDescription>
        </CardHeader>
        <CardContent>
          {options.length === 0 ? (
            <p className="text-muted-foreground text-sm">{ai.loadFailed ? 'Could not load your AI keys.' : 'Add a key above to choose a model.'}</p>
          ) : (
            <SimpleSelect
              className="w-full max-w-sm"
              value={current}
              options={options}
              onChange={(v) => {
                const [p, ...rest] = v.split(':')
                aiActions.select(p as ProviderId, rest.join(':'))
              }}
            />
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Voice</CardTitle>
          <CardDescription>Speak to the assistant and hear answers. Uses your browser or desktop speech engine, so no extra key. Saved on this device.</CardDescription>
        </CardHeader>
        <CardContent className="divide-y">
          <Row title="Read replies aloud" description="In voice mode the assistant speaks its answers.">
            <Switch checked={prefs.voice.speakReplies} onCheckedChange={(v) => aiActions.setVoice({ speakReplies: v })} aria-label="Read replies aloud" />
          </Row>
          <Row title="Send when I stop talking" description="Skip the send button in voice mode.">
            <Switch checked={prefs.voice.autoSend} onCheckedChange={(v) => aiActions.setVoice({ autoSend: v })} aria-label="Send when I stop talking" />
          </Row>
          <Row title="Language">
            <SimpleSelect
              className="w-48"
              value={prefs.voice.lang}
              onChange={(lang) => aiActions.setVoice({ lang })}
              options={[
                { value: 'en-US', label: 'English (US)' },
                { value: 'en-GB', label: 'English (UK)' },
                { value: 'ur-PK', label: 'Urdu' },
                { value: 'hi-IN', label: 'Hindi' },
                { value: 'ar-SA', label: 'Arabic' },
              ]}
            />
          </Row>
          <Row title="Speaking speed">
            <Segmented
              value={String(prefs.voice.rate)}
              onChange={(v) => aiActions.setVoice({ rate: Number(v) })}
              options={[
                { value: '0.85', label: 'Slow' },
                { value: '1', label: 'Normal' },
                { value: '1.2', label: 'Fast' },
              ]}
            />
          </Row>
        </CardContent>
      </Card>

      <MemoryCard enabled={ai.memoryEnabled} unknown={ai.loadFailed} />
    </div>
  )
}

function KeyRow({ provider, last4, modelCount }: { provider: ProviderInfo; last4?: string; modelCount?: number }) {
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function save() {
    if (!draft.trim()) return
    setBusy(true)
    setError('')
    try {
      await saveKey(provider.id, draft.trim())
      setDraft('')
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not save the key.')
    } finally {
      setBusy(false)
    }
  }

  async function remove() {
    setBusy(true)
    setError('')
    try {
      await removeKey(provider.id)
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not remove the key.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-3 py-4">
      <div className="flex items-center gap-2">
        <p className="text-sm font-medium">{provider.name}</p>
        {last4 ? (
          <Badge variant="secondary">
            <Check /> Connected
          </Badge>
        ) : (
          <Badge variant="outline">No key</Badge>
        )}
        <a href={provider.keyUrl} target="_blank" rel="noreferrer" className="text-muted-foreground hover:text-foreground ml-auto inline-flex items-center gap-1 text-xs">
          Get a key <ExternalLink className="size-3" />
        </a>
      </div>

      {last4 ? (
        <div className="flex flex-wrap items-center gap-2">
          <code className="bg-muted rounded-md px-2 py-1 text-xs">{'•'.repeat(12)}{last4}</code>
          {modelCount ? <span className="text-muted-foreground text-xs">{modelCount} models available</span> : null}
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => void remove()}>
            <Trash2 /> Remove
          </Button>
        </div>
      ) : (
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            void save()
          }}
        >
          <Input type="password" autoComplete="off" value={draft} onChange={(e) => setDraft(e.target.value)} placeholder={provider.keyHint} aria-label={`${provider.name} API key`} />
          <Button type="submit" disabled={!draft.trim() || busy}>
            {busy && <Loader2 className="animate-spin" />} Save key
          </Button>
        </form>
      )}
      {error && <p role="alert" className="text-destructive text-sm">{error}</p>}
    </div>
  )
}

function MemoryCard({ enabled, unknown }: { enabled: boolean; unknown: boolean }) {
  const [items, setItems] = useState<MemoryItem[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [forgetting, setForgetting] = useState<string | null>(null)
  const [error, setError] = useState('')
  const message = (e: unknown, fallback: string) => (e instanceof ApiError ? e.message : fallback)

  async function load() {
    setLoading(true)
    setError('')
    try {
      setItems(await listMemories())
    } catch (e) {
      // Keep the old list (or none): an empty list here would wrongly say nothing is remembered.
      setError(message(e, 'Could not load what the assistant remembers.'))
    } finally {
      setLoading(false)
    }
  }

  async function forget(id: string) {
    setForgetting(id)
    setError('')
    try {
      await forgetMemory(id)
      setItems((list) => list?.filter((m) => m.id !== id) ?? null)
    } catch (e) {
      setError(message(e, 'Could not forget that.'))
    } finally {
      setForgetting(null)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Memory</CardTitle>
        <CardDescription>
          Facts the assistant keeps about you between conversations, stored in your database with mem0. It needs an OpenAI key for embeddings.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {unknown ? (
          <p className="text-muted-foreground text-sm">Could not check whether memory is on.</p>
        ) : !enabled ? (
          <p className="text-muted-foreground text-sm">Memory is off. Add an OpenAI key above to turn it on.</p>
        ) : items === null ? (
          <Button variant="outline" size="sm" disabled={loading} onClick={() => void load()}>
            {loading && <Loader2 className="animate-spin" />} {error ? 'Try again' : 'Show what it remembers'}
          </Button>
        ) : items.length === 0 ? (
          <p className="text-muted-foreground text-sm">Nothing remembered yet.</p>
        ) : (
          <ul className="divide-y rounded-lg border">
            {items.map((m) => (
              <li key={m.id} className="flex items-center justify-between gap-3 px-4 py-2 text-sm">
                {m.text}
                <Button size="icon-sm" variant="ghost" aria-label="Forget" disabled={forgetting === m.id} onClick={() => void forget(m.id)}>
                  {forgetting === m.id ? <Loader2 className="animate-spin" /> : <Trash2 />}
                </Button>
              </li>
            ))}
          </ul>
        )}
        {error && (
          <p role="alert" className="text-destructive text-sm">
            {error}
          </p>
        )}
      </CardContent>
    </Card>
  )
}
