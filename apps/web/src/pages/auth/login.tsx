import { useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router'
import { Loader2 } from 'lucide-react'
import { AuthShell, FormError } from '@/components/auth-shell'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { authClient } from '@/lib/auth-client'
import { getLoginNotice, setLoginNotice } from '@/lib/account'

export default function LoginPage() {
  const navigate = useNavigate()
  /** A one-time message, for example after the account was deleted. */
  const notice = getLoginNotice()
  const [login, setLogin] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setLoginNotice('')
    setError('')
    setBusy(true)
    const id = login.trim()
    // People can type either their username or their email.
    const { error: err } = id.includes('@')
      ? await authClient.signIn.email({ email: id, password })
      : await authClient.signIn.username({ username: id, password })
    setBusy(false)
    if (err) {
      setError(err.message ?? 'Could not sign in. Check your details and try again.')
      return
    }
    navigate('/', { replace: true })
  }

  return (
    <AuthShell
      title="Sign in"
      description="Use your username or email."
      footer={
        <>
          No account yet?{' '}
          <Link to="/register" className="text-foreground underline underline-offset-4">
            Request access
          </Link>
        </>
      }
    >
      <form onSubmit={submit} className="space-y-4">
        {notice && !error && (
          <p role="status" className="bg-muted rounded-md border px-3 py-2 text-sm">
            {notice}
          </p>
        )}
        <FormError message={error} />
        <div className="space-y-2">
          <Label htmlFor="login">Username or email</Label>
          <Input id="login" autoComplete="username" autoFocus value={login} onChange={(e) => setLogin(e.target.value)} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="password">Password</Label>
          <Input id="password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
        </div>
        <Button type="submit" className="w-full" disabled={busy || !login.trim() || !password}>
          {busy && <Loader2 className="animate-spin" />} Sign in
        </Button>
      </form>
    </AuthShell>
  )
}
