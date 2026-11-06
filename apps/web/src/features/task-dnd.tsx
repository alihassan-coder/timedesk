import { useState, type DragEvent, type ReactNode } from 'react'
import { cn } from '@/lib/utils'

/**
 * Drag and drop for tasks, using the browser's own drag events (no extra library).
 * A task is dragged by id, and a DropZone tells the page where it landed.
 */
const MIME = 'application/x-timedesk-task'

/** Spread on any element to make it a draggable task. */
export function taskDragProps(taskId: string) {
  return {
    draggable: true,
    onDragStart: (e: DragEvent) => {
      e.dataTransfer.setData(MIME, taskId)
      e.dataTransfer.setData('text/plain', taskId)
      e.dataTransfer.effectAllowed = 'move'
    },
  }
}

export function DropZone({
  onDropTask,
  className,
  overClassName = 'bg-primary/10 ring-primary/50 ring-2',
  children,
}: {
  onDropTask: (taskId: string) => void
  className?: string
  /** Applied while a task is hovering over this zone. */
  overClassName?: string
  children: ReactNode
}) {
  const [over, setOver] = useState(false)
  const isTask = (e: DragEvent) => e.dataTransfer.types.includes(MIME)
  return (
    <div
      className={cn('transition-colors', className, over && overClassName)}
      onDragOver={(e) => {
        if (!isTask(e)) return
        e.preventDefault() // required to allow a drop
        e.dataTransfer.dropEffect = 'move'
        if (!over) setOver(true)
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOver(false)
      }}
      onDrop={(e) => {
        if (!isTask(e)) return
        e.preventDefault()
        setOver(false)
        const id = e.dataTransfer.getData(MIME)
        if (id) onDropTask(id)
      }}
    >
      {children}
    </div>
  )
}
