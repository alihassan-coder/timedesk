import { useState, type FormEvent } from 'react'
import { Play, Square, Trash2 } from 'lucide-react'
import { formatDuration, totalsByTask } from '@timedesk/shared'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { actions, useStore } from '@/data/store'
import { useNow } from '@/data/use-now'

export function TasksView() {
  const { tasks, entries } = useStore()
  const [title, setTitle] = useState('')
  const running = entries.find((e) => e.endedAt === null)
  const now = useNow(!!running)
  const todayByTask = totalsByTask(entries, 'day', now)

  function submit(e: FormEvent) {
    e.preventDefault()
    actions.addTask(title)
    setTitle('')
  }

  return (
    <div className="space-y-4">
      <form onSubmit={submit} className="flex gap-2">
        <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Add a task and press Enter" />
        <Button type="submit">Add</Button>
      </form>

      {tasks.length === 0 && <p className="text-muted-foreground text-sm">No tasks yet. Add your first one above.</p>}

      <ul className="divide-y rounded-lg border">
        {tasks.map((t) => (
          <li key={t.id} className="flex items-center gap-3 px-4 py-3">
            <Checkbox checked={t.done} onCheckedChange={() => actions.toggleTask(t.id)} />
            <span className={t.done ? 'text-muted-foreground flex-1 line-through' : 'flex-1'}>{t.title}</span>
            <span className="text-muted-foreground font-mono text-sm tabular-nums">
              {formatDuration(todayByTask.get(t.id) ?? 0)}
            </span>
            {running?.taskId === t.id ? (
              <Button size="icon" variant="destructive" onClick={actions.stopTimer} aria-label="Stop timer">
                <Square />
              </Button>
            ) : (
              <Button size="icon" variant="outline" onClick={() => actions.startTimer(t.id)} aria-label="Start timer">
                <Play />
              </Button>
            )}
            <Button size="icon" variant="ghost" onClick={() => actions.deleteTask(t.id)} aria-label="Delete task">
              <Trash2 />
            </Button>
          </li>
        ))}
      </ul>
    </div>
  )
}
