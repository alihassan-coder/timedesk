import { useState, type FormEvent } from 'react'
import { Link } from 'react-router'
import { CheckCircle2, Loader2 } from 'lucide-react'
import { AuthShell, FormError } from '@/components/auth-shell'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { authClient } from '@/lib/auth-client'

const USERNAME = /^[a-zA-Z0-9_.]{3,30}$/

export default function RegisterPage() {
  const [form, setForm] = useState({ name: '', username: '', email: '', password: '', confirm: '' })
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(false)
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, [k]: e.target.value })

  async function submit(e: FormEvent) {
    e.preventDefault()
    setError('')
    if (!USERNAME.test(form.username)) return setError('Username must be 3 to 30 letters, numbers, dots or underscores.')
    if (form.password.length < 8) return setError('Password must be at least 8 characters.')
    if (form.password !== form.confirm) return setError('The two passwords do not match.')
    setBusy(true)
    const { error: err } = await authClient.signUp.email({
      name: form.name.trim(),
      username: form.username,
      email: form.email.trim(),
      password: form.password,
    })
    setBusy(false)
    if (err) return setError(err.message ?? 'Could not create the account.')
    setDone(true)
  }

  if (done) {
    return (
      <AuthShell title="Request sent" description="An admin has to approve your account before you can sign in.">
        <div className="flex items-start gap-3 text-sm">
          <CheckCircle2 className="text-primary mt-0.5 size-5 shrink-0" />
          <p>
            We saved your request for <strong>{form.email}</strong>. Once an admin approves it you can sign in with your username or email.
          </p>
        </div>
        <Button variant="outline" className="w-full" render={<Link to="/login" />}>
          Go to sign in
        </Button>
      </AuthShell>
    )
  }

  return (
    <AuthShell
      title="Request access"
      description="Create your account. An admin approves new accounts."
      footer={
        <>
          Already approved?{' '}
          <Link to="/login" className="text-foreground underline underline-offset-4">
            Sign in
          </Link>
        </>
      }
    >
      <form onSubmit={submit} className="space-y-4">
        <FormError message={error} />
        <div className="space-y-2">
          <Label htmlFor="name">Full name</Label>
          <Input id="name" autoComplete="name" autoFocus value={form.name} onChange={set('name')} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="username">Username</Label>
          <Input id="username" autoComplete="username" value={form.username} onChange={set('username')} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="email">Email</Label>
          <Input id="email" type="email" autoComplete="email" value={form.email} onChange={set('email')} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="password">Password</Label>
          <Input id="password" type="password" autoComplete="new-password" value={form.password} onChange={set('password')} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="confirm">Confirm password</Label>
          <Input id="confirm" type="password" autoComplete="new-password" value={form.confirm} onChange={set('confirm')} />
        </div>
        <Button type="submit" className="w-full" disabled={busy || !form.name.trim() || !form.username || !form.email || !form.password}>
          {busy && <Loader2 className="animate-spin" />} Request access
        </Button>
      </form>
    </AuthShell>
  )
}
