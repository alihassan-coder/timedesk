import { Bell } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverHeader, PopoverTitle, PopoverTrigger } from '@/components/ui/popover'

/** Reminders and updates will appear here once notifications are connected (desktop app and browser). */
export function NotificationsBell() {
  return (
    <Popover>
      <PopoverTrigger render={<Button size="icon-sm" variant="ghost" aria-label="Notifications" />}>
        <Bell />
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80">
        <PopoverHeader>
          <PopoverTitle>Notifications</PopoverTitle>
        </PopoverHeader>
        <p className="text-muted-foreground text-sm">You are all caught up. Due-date reminders will show up here.</p>
      </PopoverContent>
    </Popover>
  )
}
