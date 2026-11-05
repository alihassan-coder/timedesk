import { inferAdditionalFields, usernameClient } from 'better-auth/client/plugins'
import { createAuthClient } from 'better-auth/react'

export const API_URL: string = import.meta.env.VITE_API_URL ?? 'http://localhost:3001'

export const authClient = createAuthClient({
  baseURL: API_URL,
  basePath: '/api/auth',
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
