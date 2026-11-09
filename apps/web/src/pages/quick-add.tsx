import { useEffect, useMemo, useRef, useState } from 'react'
import { CornerDownLeft } from 'lucide-react'
import { parseQuickAdd } from '@timedesk/shared'
import { actions, bindStore, loadStore, setMutationHook, useStore } from '@/data/store'
import { useAppearance } from '@/lib/appearance'
import { useProfile } from '@/lib/auth-client'
import { getDesktop } from '@/lib/desktop'

/**
 * Quick add: a tiny window the desktop app opens with Ctrl+Alt+N from any program. Type a task in plain words,
 * for example "Call the printer tomorrow !high #website", and press Enter.
 */
export default function QuickAddPage() {
  const { user } = useProfile()
  const d = getDesktop()
  const { projects } = useStore()
  const [text, setText] = useState('')
  const [done, setDone] = useState('')
  const input = useRef<HTMLInputElement>(null)
  useAppearance()

  useEffect(() => {
    if (!user?.id) return
    bindStore(user.id)
    setMutationHook(() => d?.dataChanged())
    const refocus = () => {
      setText('')
      setDone('')
      void loadStore() // new projects may have been added since the window was last shown
      setTimeout(() => input.current?.focus(), 30)
    }
    const off = d?.onQuickAddShown(refocus)
    return () => {
      off?.()
      setMutationHook(null)
    }
  }, [user?.id, d])

  const parsed = useMemo(() => parseQuickAdd(text, { now: Date.now(), projects }), [text, projects])

  function submit() {
    if (!parsed.title) return
    // Saved on this device at once, so it is never lost; it reaches the server now, or when the connection is back.
    const id = actions.addTask({ title: parsed.title, projectId: parsed.projectId, priority: parsed.priority, due: parsed.due, recurrence: null })
    if (!id) return
    setDone(navigator.onLine === false ? `Saved offline: ${parsed.title}. It syncs when you are back online.` : `Added: ${parsed.title}`)
    setText('')
    setTimeout(() => d?.closeOwnWindow(), navigator.onLine === false ? 1600 : 650)
  }

  return (
    <div className="bg-background text-foreground flex h-svh w-svw flex-col justify-center gap-2.5 overflow-hidden border px-4">
      <input
        ref={input}
        autoFocus
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') submit()
          if (e.key === 'Escape') d?.closeOwnWindow()
        }}
        placeholder="Add a task. Try: Call the printer tomorrow !high #website"
        aria-label="New task"
        className="placeholder:text-muted-foreground w-full bg-transparent text-base font-medium outline-none"
      />
      <div className="flex min-h-6 items-center justify-between gap-3">
        <div className="flex min-w-0 flex-wrap gap-1.5">
          {done ? (
            <span className="text-primary text-xs font-medium">{done}</span>
          ) : parsed.hints.length > 0 ? (
            parsed.hints.map((h) => (
              <span key={h} className="bg-primary/10 text-primary rounded-full px-2 py-0.5 text-xs font-medium">
                {h}
              </span>
            ))
          ) : (
            <span className="text-muted-foreground text-xs">Dates, !priority and #project are understood.</span>
          )}
        </div>
        <span className="text-muted-foreground flex shrink-0 items-center gap-1 text-xs">
          <CornerDownLeft className="size-3" /> Enter to add, Esc to close
        </span>
      </div>
    </div>
  )
}
