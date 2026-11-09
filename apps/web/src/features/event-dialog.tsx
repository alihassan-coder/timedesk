import { useState } from 'react'
import { Loader2, Trash2 } from 'lucide-react'
import { addDays, toDateKey, type CalendarEvent } from '@timedesk/shared'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { ApiError } from '@/lib/api'
import { createGoogleEvent, deleteGoogleEvent, updateGoogleEvent, type EventInput } from '@/lib/google'

/** "2026-11-10T09:30" in local time, the format a datetime-local field wants. */
const toLocalInput = (d: Date) => `${toDateKey(d.getTime())}T${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
const atHour = (day: string, hour: number) => `${day}T${String(hour).padStart(2, '0')}:00`

/** Add, edit or delete one Google Calendar event. */
export function EventDialog({
  open,
  event,
  defaultDay,
  onClose,
  onChanged,
}: {
  open: boolean
  /** The event to edit, or null to add a new one. */
  event: CalendarEvent | null
  defaultDay: string
  onClose: () => void
  /** Called after a save or delete so the screen can reload its events. */
  onChanged: () => void
}) {
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>{open && <EventForm key={event?.id ?? `new-${defaultDay}`} event={event} defaultDay={defaultDay} onClose={onClose} onChanged={onChanged} />}</DialogContent>
    </Dialog>
  )
}

function EventForm({ event, defaultDay, onClose, onChanged }: { event: CalendarEvent | null; defaultDay: string; onClose: () => void; onChanged: () => void }) {
  const editing = event !== null
  const [title, setTitle] = useState(event?.title ?? '')
  const [description, setDescription] = useState(event?.description ?? '')
  const [allDay, setAllDay] = useState(event?.allDay ?? false)

  // All-day: dates, with the last day included (Google stores the day after, we show what people expect).
  const [startDay, setStartDay] = useState(event ? (event.allDay ? event.start : toDateKey(new Date(event.start).getTime())) : defaultDay)
  const [endDay, setEndDay] = useState(event?.allDay ? (event.end > event.start ? addDays(event.end, -1) : event.start) : event ? toDateKey(new Date(event.end).getTime()) : defaultDay)
  // Timed: date and time together. An all-day event switched to timed starts on its own first day, not on defaultDay.
  const timedDay = event?.allDay ? event.start : defaultDay
  const [startAt, setStartAt] = useState(event && !event.allDay ? toLocalInput(new Date(event.start)) : atHour(timedDay, 9))
  const [endAt, setEndAt] = useState(event && !event.allDay ? toLocalInput(new Date(event.end)) : atHour(timedDay, 10))

  const [busy, setBusy] = useState<'save' | 'delete' | ''>('')
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [error, setError] = useState('')

  const problem = !title.trim()
    ? 'Give the event a title.'
    : allDay
      ? !startDay || !endDay
        ? 'Pick a date.'
        : endDay < startDay
          ? 'The last day must not be before the first day.'
          : ''
      : !startAt || !endAt
        ? 'Pick a start and an end.'
        : new Date(endAt) <= new Date(startAt)
          ? 'The end must be after the start.'
          : ''

  async function save() {
    if (problem) return
    setBusy('save')
    setError('')
    const input: EventInput = allDay
      ? { title: title.trim(), description, allDay: true, start: startDay, end: addDays(endDay, 1) }
      : { title: title.trim(), description, allDay: false, start: new Date(startAt).toISOString(), end: new Date(endAt).toISOString() }
    try {
      if (event) await updateGoogleEvent(event.id, input)
      else await createGoogleEvent(input)
      onChanged()
      onClose()
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not reach the server.')
    } finally {
      setBusy('')
    }
  }

  async function remove() {
    if (!event) return
    setBusy('delete')
    setError('')
    try {
      await deleteGoogleEvent(event.id)
      onChanged()
      onClose()
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not reach the server.')
    } finally {
      setBusy('')
    }
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>{editing ? 'Edit event' : 'New event'}</DialogTitle>
      </DialogHeader>
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault()
          void save()
        }}
      >
        <div className="space-y-2">
          <Label htmlFor="ev-title">Title</Label>
          <Input id="ev-title" autoFocus value={title} onChange={(e) => setTitle(e.target.value)} placeholder="What is happening?" maxLength={300} />
        </div>

        <div className="flex items-center justify-between rounded-lg border px-3 py-2">
          <Label htmlFor="ev-allday">All day</Label>
          <Switch id="ev-allday" checked={allDay} onCheckedChange={setAllDay} aria-label="All day" />
        </div>

        {allDay ? (
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="ev-start-day">First day</Label>
              <Input id="ev-start-day" type="date" value={startDay} onChange={(e) => { setStartDay(e.target.value); if (endDay < e.target.value) setEndDay(e.target.value) }} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="ev-end-day">Last day</Label>
              <Input id="ev-end-day" type="date" min={startDay} value={endDay} onChange={(e) => setEndDay(e.target.value)} />
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="ev-start-at">Starts</Label>
              <Input id="ev-start-at" type="datetime-local" value={startAt} onChange={(e) => setStartAt(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="ev-end-at">Ends</Label>
              <Input id="ev-end-at" type="datetime-local" min={startAt} value={endAt} onChange={(e) => setEndAt(e.target.value)} />
            </div>
          </div>
        )}

        <div className="space-y-2">
          <Label htmlFor="ev-desc">Notes</Label>
          <Input id="ev-desc" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Optional" maxLength={5000} />
        </div>

        {(error || (problem && title)) && (
          <p role="alert" className="text-destructive text-sm">
            {error || problem}
          </p>
        )}

        <DialogFooter className="sm:justify-between">
          {editing ? (
            confirmDelete ? (
              <div className="flex items-center gap-2">
                <Button type="button" variant="destructive" disabled={busy !== ''} onClick={remove}>
                  {busy === 'delete' ? <Loader2 className="animate-spin" /> : <Trash2 />} Yes, delete it
                </Button>
                <Button type="button" variant="ghost" onClick={() => setConfirmDelete(false)}>
                  Keep
                </Button>
              </div>
            ) : (
              <Button type="button" variant="outline" onClick={() => setConfirmDelete(true)}>
                <Trash2 /> Delete
              </Button>
            )
          ) : (
            <span />
          )}
          <Button type="submit" disabled={busy !== '' || Boolean(problem)}>
            {busy === 'save' && <Loader2 className="animate-spin" />} {editing ? 'Save changes' : 'Add event'}
          </Button>
        </DialogFooter>
      </form>
    </>
  )
}
