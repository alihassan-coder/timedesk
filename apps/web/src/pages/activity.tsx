import { PageHeader } from '@/components/page-header'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { activity, team } from '@/data/seed'
import { timeAgo } from '@/lib/format'

export default function ActivityPage() {
  const now = Date.now()
  return (
    <>
      <PageHeader title="Activity" description="Everything that changed across your projects." />
      <ul className="divide-y rounded-lg border">
        {activity(now).map((a) => {
          const user = team.find((u) => u.name === a.who)
          return (
            <li key={a.id} className="flex items-center gap-3 px-4 py-3">
              <Avatar className="size-8">
                <AvatarFallback>{user?.initials ?? '?'}</AvatarFallback>
              </Avatar>
              <p className="flex-1 text-sm">
                <span className="font-medium">{a.who}</span> {a.text} <span className="font-medium">{a.target}</span>
              </p>
              <span className="text-muted-foreground text-sm">{timeAgo(a.at, now)}</span>
            </li>
          )
        })}
      </ul>
    </>
  )
}
