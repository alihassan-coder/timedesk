import { useCallback, useEffect, useRef, useState } from 'react'
import { Check, X } from 'lucide-react'
import { PageHeader } from '@/components/page-header'
import { Segmented } from '@/components/segmented'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { api, ApiError } from '@/lib/api'
import { useProfile } from '@/lib/auth-client'

type Status = 'pending' | 'approved' | 'rejected'
interface Member {
  id: string
  name: string
  email: string
  username: string | null
  role: string
  status: Status
  createdAt: string
}

export default function AdminPage() {
  const { user } = useProfile()
  const [status, setStatus] = useState<Status>('pending')
  const [members, setMembers] = useState<Member[] | null>(null)
  const [error, setError] = useState('')
  // People whose approve or reject is on its way, so a second click cannot send it twice.
  const [busy, setBusy] = useState<ReadonlySet<string>>(new Set())
  // Only the newest request may fill the table: a slow answer for the previous tab must not show up here.
  const request = useRef(0)

  const load = useCallback(async (s: Status) => {
    const mine = ++request.current
    setError('')
    try {
      const { users } = await api<{ users: Member[] }>(`/admin/users?status=${s}`)
      if (mine === request.current) setMembers(users)
    } catch (e) {
      if (mine !== request.current) return
      setError(e instanceof ApiError ? e.message : 'Could not load members.')
      setMembers((m) => m ?? [])
    }
  }, [])

  useEffect(() => {
    void load(status)
  }, [status, load])

  const switchTab = (s: Status) => {
    setMembers(null) // the old tab's people must not show under the new tab's name
    setStatus(s)
  }

  async function decide(id: string, action: 'approve' | 'reject') {
    if (busy.has(id)) return
    setBusy((b) => new Set(b).add(id))
    try {
      await api(`/admin/users/${id}/${action}`, { method: 'POST' })
      await load(status)
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Something went wrong.')
    } finally {
      setBusy((b) => {
        const next = new Set(b)
        next.delete(id)
        return next
      })
    }
  }

  if (!user?.isAdmin) return <p className="text-muted-foreground">Only admins can see this page.</p>

  return (
    <>
      <PageHeader
        title="Team members"
        description="Approve new accounts before they can sign in."
        actions={
          <Segmented<Status>
            value={status}
            onChange={switchTab}
            options={[
              { value: 'pending', label: 'Pending' },
              { value: 'approved', label: 'Approved' },
              { value: 'rejected', label: 'Rejected' },
            ]}
          />
        }
      />
      {error && <p role="alert" className="text-destructive text-sm">{error}</p>}
      <div className="rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Username</TableHead>
              <TableHead>Email</TableHead>
              <TableHead>Requested</TableHead>
              <TableHead className="text-right">Action</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {members === null && (
              <TableRow>
                <TableCell colSpan={5} className="text-muted-foreground">Loading...</TableCell>
              </TableRow>
            )}
            {members?.length === 0 && (
              <TableRow>
                <TableCell colSpan={5} className="text-muted-foreground">No {status} accounts.</TableCell>
              </TableRow>
            )}
            {members?.map((m) => (
              <TableRow key={m.id}>
                <TableCell className="font-medium">
                  {m.name} {m.role === 'admin' && <Badge variant="secondary">Admin</Badge>}
                </TableCell>
                <TableCell>{m.username}</TableCell>
                <TableCell>{m.email}</TableCell>
                <TableCell>{new Date(m.createdAt).toLocaleDateString()}</TableCell>
                <TableCell className="text-right">
                  {m.id === user.id ? (
                    <span className="text-muted-foreground text-sm">You</span>
                  ) : (
                    <div className="flex justify-end gap-2">
                      {m.status !== 'approved' && (
                        <Button size="sm" disabled={busy.has(m.id)} onClick={() => decide(m.id, 'approve')}>
                          <Check /> Approve
                        </Button>
                      )}
                      {m.status !== 'rejected' && (
                        <Button size="sm" variant="outline" disabled={busy.has(m.id)} onClick={() => decide(m.id, 'reject')}>
                          <X /> Reject
                        </Button>
                      )}
                    </div>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </>
  )
}
