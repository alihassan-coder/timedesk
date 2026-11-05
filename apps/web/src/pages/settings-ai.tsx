import { useState } from 'react'
import { Check, Eye, EyeOff, ExternalLink, Loader2, RefreshCw, Trash2 } from 'lucide-react'
import { Segmented } from '@/components/segmented'
import { SimpleSelect } from '@/components/simple-select'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { memory } from '@/lib/ai/memory'
import { fetchModels, PROVIDERS, type ProviderInfo } from '@/lib/ai/providers'
import { aiActions, availableModels, useAiSettings } from '@/lib/ai/settings'
import { Row } from '@/components/setting-row'

export function AiTab() {
  const ai = useAiSettings()
  const groups = availableModels(ai)
  const options = groups.flatMap((g) => g.models.map((m) => ({ value: `${g.provider.id}:${m}`, label: `${g.provider.name} · ${m}` })))
  const current = ai.selected ? `${ai.selected.provider}:${ai.selected.model}` : (options[0]?.value ?? '')

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>API keys</CardTitle>
          <CardDescription>
            Add the providers you use. The assistant only offers models from providers that have a key. Keys are saved on this device
            for now; once the API exists they move to encrypted storage on the server.
          </CardDescription>
        </CardHeader>
        <CardContent className="divide-y">
          {PROVIDERS.map((p) => (
            <KeyRow key={p.id} provider={p} />
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Default model</CardTitle>
          <CardDescription>Used when you open the assistant. You can switch per message.</CardDescription>
        </CardHeader>
        <CardContent>
          {options.length === 0 ? (
            <p className="text-muted-foreground text-sm">Add a key above to choose a model.</p>
          ) : (
            <SimpleSelect
              className="w-full max-w-sm"
              value={current}
              options={options}
              onChange={(v) => {
                const [p, ...rest] = v.split(':')
                aiActions.select(p as never, rest.join(':'))
              }}
            />
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Voice</CardTitle>
          <CardDescription>Speak to the assistant and hear answers. Uses your browser or desktop speech engine, so no extra key.</CardDescription>
        </CardHeader>
        <CardContent className="divide-y">
          <Row title="Read replies aloud" description="In voice mode the assistant speaks its answers.">
            <Switch checked={ai.voice.speakReplies} onCheckedChange={(v) => aiActions.setVoice({ speakReplies: v })} aria-label="Read replies aloud" />
          </Row>
          <Row title="Send when I stop talking" description="Skip the send button in voice mode.">
            <Switch checked={ai.voice.autoSend} onCheckedChange={(v) => aiActions.setVoice({ autoSend: v })} aria-label="Send when I stop talking" />
          </Row>
          <Row title="Language">
            <SimpleSelect
              className="w-48"
              value={ai.voice.lang}
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
              value={String(ai.voice.rate)}
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

      <MemoryCard />
    </div>
  )
}

function KeyRow({ provider }: { provider: ProviderInfo }) {
  const ai = useAiSettings()
  const saved = ai.keys[provider.id]
  const [draft, setDraft] = useState('')
  const [show, setShow] = useState(false)
  const [loading, setLoading] = useState(false)
  const count = ai.models[provider.id]?.length

  async function save() {
    const key = draft.trim()
    if (!key) return
    aiActions.setKey(provider.id, key)
    setDraft('')
    await refresh(key)
  }

  async function refresh(key = saved) {
    if (!key) return
    setLoading(true)
    aiActions.setModels(provider.id, await fetchModels(provider.id, key))
    setLoading(false)
  }

  return (
    <div className="space-y-3 py-4">
      <div className="flex items-center gap-2">
        <p className="text-sm font-medium">{provider.name}</p>
        {saved ? <Badge variant="secondary"><Check /> Connected</Badge> : <Badge variant="outline">No key</Badge>}
        <a href={provider.keyUrl} target="_blank" rel="noreferrer" className="text-muted-foreground hover:text-foreground ml-auto inline-flex items-center gap-1 text-xs">
          Get a key <ExternalLink className="size-3" />
        </a>
      </div>

      {saved ? (
        <div className="flex flex-wrap items-center gap-2">
          <code className="bg-muted rounded-md px-2 py-1 text-xs">{show ? saved : `${saved.slice(0, 4)}${'•'.repeat(12)}${saved.slice(-3)}`}</code>
          <Button size="icon-sm" variant="ghost" aria-label={show ? 'Hide key' : 'Show key'} onClick={() => setShow(!show)}>
            {show ? <EyeOff /> : <Eye />}
          </Button>
          <Button size="sm" variant="outline" disabled={loading} onClick={() => refresh()}>
            {loading ? <Loader2 className="animate-spin" /> : <RefreshCw />} {count ? `${count} models` : 'Load models'}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => aiActions.setKey(provider.id, '')}>
            <Trash2 /> Remove
          </Button>
        </div>
      ) : (
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            save()
          }}
        >
          <Input type="password" autoComplete="off" value={draft} onChange={(e) => setDraft(e.target.value)} placeholder={provider.keyHint} aria-label={`${provider.name} API key`} />
          <Button type="submit" disabled={!draft.trim() || loading}>
            {loading && <Loader2 className="animate-spin" />} Save key
          </Button>
        </form>
      )}
    </div>
  )
}

function MemoryCard() {
  const [items, setItems] = useState(() => memory.list())
  return (
    <Card>
      <CardHeader>
        <CardTitle>Memory</CardTitle>
        <CardDescription>
          Facts the assistant keeps about you between conversations. Today they stay on this device; the plan is the mem0 open source
          SDK storing them in your Neon database.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {items.length === 0 ? (
          <p className="text-muted-foreground text-sm">Nothing remembered yet.</p>
        ) : (
          <ul className="divide-y rounded-lg border">
            {items.map((m) => (
              <li key={m.id} className="flex items-center justify-between gap-3 px-4 py-2 text-sm">
                {m.text}
                <Button size="icon-sm" variant="ghost" aria-label="Forget" onClick={() => { memory.remove(m.id); setItems(memory.list()) }}>
                  <Trash2 />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}
