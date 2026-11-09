import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router'
import { CornerDownLeft, Moon, Play, Plus, Search, Sparkles, Square } from 'lucide-react'
import { parseQuickAdd } from '@timedesk/shared'
import { ProjectDot } from '@/components/project-dot'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { actions, lastTimerTarget, useStore } from '@/data/store'
import { askTempoLink, TEMPO_PROMPTS } from '@/features/assistant/tempo-prompts'
import { toggleMode } from '@/lib/appearance'
import { navGroups } from '@/lib/nav'
import { cn } from '@/lib/utils'

interface Command {
  id: string
  group: 'Timer' | 'Add' | 'Tempo' | 'Tasks' | 'Go to' | 'Other'
  label: string
  hint?: string
  icon?: React.ReactNode
  run: () => void
}

/** Every word typed must appear somewhere in the text, in any order. */
const matches = (text: string, query: string) => {
  const t = text.toLowerCase()
  return query
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((w) => t.includes(w))
}

/**
 * Ctrl+K (or Cmd+K) opens a search box for everything: jump to a page, start a timer on a task,
 * stop the timer, or add a task by typing it in plain words.
 */
export function CommandPalette() {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const navigate = useNavigate()
  const { tasks, projects, entries } = useStore()
  const list = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setOpen((o) => !o)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const close = () => {
    setOpen(false)
    setQuery('')
    setActive(0)
  }

  const running = entries.some((e) => e.endedAt === null)
  // Built only while the palette is open: closed, it would rebuild up to 200 task commands on every store change.
  const commands = useMemo<Command[]>(() => {
    if (!open) return []
    const out: Command[] = []
    if (running) out.push({ id: 'stop', group: 'Timer', label: 'Stop the timer', icon: <Square />, run: () => void actions.stopTimer() })
    else {
      const last = lastTimerTarget(entries)
      out.push({
        id: 'resume',
        group: 'Timer',
        label: last ? 'Resume the last timer' : 'Start a stopwatch',
        icon: <Play />,
        run: () => void actions.resumeLast(),
      })
    }
    for (const prompt of [TEMPO_PROMPTS.plan, TEMPO_PROMPTS.day, TEMPO_PROMPTS.week]) {
      out.push({ id: `tempo-${prompt}`, group: 'Tempo', label: prompt, icon: <Sparkles />, run: () => navigate(askTempoLink(prompt)) })
    }
    const projectsById = new Map(projects.map((p) => [p.id, p]))
    for (const t of tasks.filter((x) => x.status !== 'done').slice(0, 200)) {
      out.push({
        id: `start-${t.id}`,
        group: 'Tasks',
        label: `Start timer: ${t.title}`,
        icon: <ProjectDot project={t.projectId ? projectsById.get(t.projectId) : undefined} />,
        run: () => void actions.startTimer({ taskId: t.id }),
      })
    }
    for (const g of navGroups) {
      for (const n of g.items) out.push({ id: `go-${n.to}`, group: 'Go to', label: n.label, run: () => navigate(n.to) })
    }
    out.push({ id: 'theme', group: 'Other', label: 'Switch light and dark mode', icon: <Moon />, run: toggleMode })
    return out
  }, [open, tasks, projects, entries, running, navigate])

  const q = query.trim()
  const parsed = useMemo(() => (q ? parseQuickAdd(q, { now: Date.now(), projects }) : null), [q, projects])
  const shown = useMemo(() => {
    const found = q ? commands.filter((c) => matches(`${c.label} ${c.group}`, q)) : commands.filter((c) => c.group !== 'Tasks').slice(0, 12)
    const add: Command[] =
      parsed && parsed.title
        ? [
            {
              id: 'add',
              group: 'Add',
              label: `Add task: ${parsed.title}`,
              hint: parsed.hints.join(' · '),
              icon: <Plus />,
              run: () => void actions.addTask({ title: parsed.title, projectId: parsed.projectId, priority: parsed.priority, due: parsed.due, recurrence: null }),
            },
          ]
        : []
    return [...found.slice(0, 30), ...add]
  }, [commands, q, parsed])

  const index = Math.min(active, Math.max(0, shown.length - 1))
  useEffect(() => {
    list.current?.querySelector('[data-active=true]')?.scrollIntoView({ block: 'nearest' })
  }, [index, shown])

  const run = (c: Command | undefined) => {
    if (!c) return
    close()
    c.run()
  }

  let lastGroup = ''
  return (
    <Dialog open={open} onOpenChange={(o) => (o ? setOpen(true) : close())}>
      <DialogContent className="top-[20%] translate-y-0 gap-0 overflow-hidden p-0 sm:max-w-xl" showCloseButton={false}>
        <DialogTitle className="sr-only">Command palette</DialogTitle>
        <DialogDescription className="sr-only">Search pages and tasks, start a timer, or add a task.</DialogDescription>
        <div className="flex items-center gap-2 border-b px-3">
          <Search className="text-muted-foreground size-4 shrink-0" />
          <input
            autoFocus
            value={query}
            onChange={(e) => {
              setQuery(e.target.value)
              setActive(0)
            }}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') {
                e.preventDefault()
                setActive((index + 1) % Math.max(1, shown.length))
              } else if (e.key === 'ArrowUp') {
                e.preventDefault()
                setActive((index - 1 + shown.length) % Math.max(1, shown.length))
              } else if (e.key === 'Enter') {
                e.preventDefault()
                run(shown[index])
              }
            }}
            placeholder="Type a command, a task, or a new task to add"
            aria-label="Command palette"
            className="placeholder:text-muted-foreground h-12 flex-1 bg-transparent text-sm outline-none"
          />
          <kbd className="text-muted-foreground rounded border px-1.5 py-0.5 text-[11px]">esc</kbd>
        </div>
        <div ref={list} className="max-h-80 overflow-y-auto p-1.5" role="listbox">
          {shown.length === 0 && <p className="text-muted-foreground p-6 text-center text-sm">Nothing matches. Keep typing to add it as a task.</p>}
          {shown.map((c, i) => {
            const header = c.group !== lastGroup
            lastGroup = c.group
            return (
              <div key={c.id}>
                {header && <p className="text-muted-foreground px-2 pt-2 pb-1 text-[11px] font-semibold tracking-wide uppercase">{c.group}</p>}
                <button
                  type="button"
                  role="option"
                  aria-selected={i === index}
                  data-active={i === index}
                  onMouseMove={() => setActive(i)}
                  onClick={() => run(c)}
                  className={cn('flex w-full items-center gap-2.5 rounded-md px-2 py-2 text-left text-sm [&_svg]:size-4 [&_svg]:shrink-0', i === index && 'bg-accent')}
                >
                  <span className="text-muted-foreground flex size-4 items-center justify-center">{c.icon}</span>
                  <span className="min-w-0 flex-1 truncate">{c.label}</span>
                  {c.hint && <span className="text-primary text-xs">{c.hint}</span>}
                  {i === index && <CornerDownLeft className="text-muted-foreground" />}
                </button>
              </div>
            )
          })}
        </div>
      </DialogContent>
    </Dialog>
  )
}
