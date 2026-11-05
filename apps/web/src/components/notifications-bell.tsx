import { Bell } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverHeader, PopoverTitle, PopoverTrigger } from '@/components/ui/popover'
import { notifications } from '@/data/seed'
import { timeAgo } from '@/lib/format'

const items = notifications(Date.now())

export function NotificationsBell() {
  const unread = items.filter((n) => n.unread).length
  return (
    <Popover>
      <PopoverTrigger render={<Button size="icon-sm" variant="ghost" className="relative" aria-label="Notifications" />}>
        <Bell />
        {unread > 0 && <span className="bg-primary absolute top-1 right-1 size-2 rounded-full" />}
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80">
        <PopoverHeader>
          <PopoverTitle>Notifications</PopoverTitle>
        </PopoverHeader>
        <ul className="divide-y">
          {items.map((n) => (
            <li key={n.id} className="flex gap-2 py-2 text-sm">
              <span className={n.unread ? 'bg-primary mt-1.5 size-2 shrink-0 rounded-full' : 'mt-1.5 size-2 shrink-0'} />
              <div>
                <p>{n.title}</p>
                <p className="text-muted-foreground text-xs">{timeAgo(n.at)}</p>
              </div>
            </li>
          ))}
        </ul>
      </PopoverContent>
    </Popover>
  )
}
