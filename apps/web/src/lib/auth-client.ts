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
  await authClient.signOut()
  bearer = ''
  await getDesktop()?.tokens.clear()
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

/** The signed-in person, shaped for the UI. `null` while loading or signed out. */
export function useProfile() {
  const { data, isPending } = authClient.useSession()
  const u = data?.user
  const name = u?.name ?? ''
  return {
    isPending,
    user: u
      ? {
          id: u.id,
          name,
          username: (u as { username?: string | null }).username ?? name,
          email: u.email,
          isAdmin: u.role === 'admin',
          initials: name.split(/\s+/).map((p) => p[0]).slice(0, 2).join('').toUpperCase() || '?',
        }
      : null,
  }
}
