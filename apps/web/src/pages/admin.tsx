import { useCallback, useEffect, useState } from 'react'
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

  const load = useCallback(async (s: Status) => {
    setError('')
    try {
      setMembers((await api<{ users: Member[] }>(`/admin/users?status=${s}`)).users)
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not load members.')
      setMembers([])
    }
  }, [])

  useEffect(() => {
    void load(status)
  }, [status, load])

  async function decide(id: string, action: 'approve' | 'reject') {
    try {
      await api(`/admin/users/${id}/${action}`, { method: 'POST' })
      await load(status)
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Something went wrong.')
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
            onChange={setStatus}
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
                        <Button size="sm" onClick={() => decide(m.id, 'approve')}>
                          <Check /> Approve
                        </Button>
                      )}
                      {m.status !== 'rejected' && (
                        <Button size="sm" variant="outline" onClick={() => decide(m.id, 'reject')}>
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
