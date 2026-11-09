import { inferAdditionalFields, usernameClient } from 'better-auth/client/plugins'
import { createAuthClient } from 'better-auth/react'
import { getDesktop } from './desktop'

export const API_URL: string = import.meta.env.VITE_API_URL ?? 'http://localhost:3001'

/**
 * Login works two ways from the SAME code:
 *  - in a browser: a cookie, handled by the browser
 *  - in the desktop app (its own address, so no usable cookie): a token. Sign-in returns it in the set-auth-token
 *    header; it is kept encrypted by the operating system (not in page storage) and sent as Authorization: Bearer.
 */
let bearer = ''

/** Desktop only: load the saved token before anything asks who is signed in. A no-op in a browser. */
export async function initDesktopAuth() {
  const desktop = getDesktop()
  if (desktop) bearer = (await desktop.tokens.get()) ?? ''
}

/** Headers that prove who is calling, for requests that do not go through the auth client. Empty in a browser. */
export const authHeaders = (): Record<string, string> => (bearer ? { Authorization: `Bearer ${bearer}` } : {})

/** Signs out and forgets the token. Use this instead of authClient.signOut. */
export async function signOut() {
  try {
    await authClient.signOut()
  } finally {
    // Even when the server cannot be reached, this device forgets the login.
    bearer = ''
    await getDesktop()?.tokens.clear().catch(() => undefined)
  }
}

export const authClient = createAuthClient({
  baseURL: API_URL,
  basePath: '/api/auth',
  ...(getDesktop()
    ? {
        fetchOptions: {
          auth: { type: 'Bearer' as const, token: () => bearer },
          onSuccess: (ctx: { response: Response }) => {
            const token = ctx.response.headers.get('set-auth-token')
            if (token) {
              bearer = token
              void getDesktop()?.tokens.set(token)
            }
          },
        },
      }
    : {}),
  plugins: [
    usernameClient(),
    inferAdditionalFields({
      user: {
        role: { type: 'string', required: false },
        status: { type: 'string', required: false },
      },
    }),
  ],
})

export interface Profile {
  id: string
  name: string
  username: string
  email: string
  isAdmin: boolean
  initials: string
}

/**
 * The last signed-in person, remembered on this device (no secrets: name, email, role). It lets the app open at once
 * from what this device has, without waiting for the server, and keeps working when there is no connection. The
 * server still decides: when it says nobody is signed in, this is forgotten and the person goes to the sign-in page.
 * The key starts with the cache prefix, so signing out clears it with the rest.
 */
const PROFILE_KEY = 'timedesk:cache:profile'
let rememberedRaw: string | null | undefined
function readProfile(): Profile | null {
  try {
    if (rememberedRaw === undefined) rememberedRaw = localStorage.getItem(PROFILE_KEY)
    return rememberedRaw ? (JSON.parse(rememberedRaw) as Profile) : null
  } catch {
    return null
  }
}
function rememberProfile(p: Profile | null) {
  const raw = p ? JSON.stringify(p) : null
  if (raw === rememberedRaw) return
  rememberedRaw = raw
  try {
    if (raw) localStorage.setItem(PROFILE_KEY, raw)
    else localStorage.removeItem(PROFILE_KEY)
  } catch {
    // storage blocked: the app still works, it just waits for the server on the next visit
  }
}
/** Forget the remembered person (sign out, account deleted). */
export const forgetProfile = () => rememberProfile(null)

/**
 * The signed-in person, shaped for the UI. `null` while loading or signed out. `offline` is true when the server could
 * not be reached and the person shown is the one this device remembers.
 */
export function useProfile(): { isPending: boolean; user: Profile | null; offline: boolean } {
  const { data, isPending, error } = authClient.useSession()
  const u = data?.user
  if (u) {
    const name = u.name ?? ''
    const user: Profile = {
      id: u.id,
      name,
      username: (u as { username?: string | null }).username ?? name,
      email: u.email,
      isAdmin: u.role === 'admin',
      initials: name.split(/s+/).map((p) => p[0]).slice(0, 2).join('').toUpperCase() || '?',
    }
    rememberProfile(user)
    return { isPending: false, user, offline: false }
  }
  // While the server is asked (it may be waking up) or cannot be reached, use the person this device remembers.
  const remembered = readProfile()
  const unreachable = !!error && (error as { status?: number }).status !== 401
  if (remembered && (isPending || unreachable)) return { isPending: false, user: remembered, offline: unreachable }
  // The server answered: nobody is signed in.
  if (!isPending && !error && remembered) rememberProfile(null)
  return { isPending, user: null, offline: unreachable }
}
