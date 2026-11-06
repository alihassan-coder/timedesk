/**
 * Everything the API needs from Google, behind one interface. The real client talks to Google over
 * HTTPS; tests and the in-memory dev server use the fake in google-fake.ts, so nothing ever hits the network.
 */

export interface GoogleWhen {
  /** All-day events use a date (YYYY-MM-DD). */
  date?: string | null
  /** Timed events use an RFC 3339 date-time. null clears it when an event changes between all-day and timed. */
  dateTime?: string | null
  timeZone?: string
}

export interface GoogleEvent {
  id: string
  /** "cancelled" for an event that was deleted (only returned when asked for). */
  status?: string
  summary?: string
  description?: string
  htmlLink?: string
  etag?: string
  updated?: string
  start?: GoogleWhen
  end?: GoogleWhen
  extendedProperties?: { private?: Record<string, string> }
}

export interface GoogleEventInput {
  summary?: string
  description?: string
  start?: GoogleWhen
  end?: GoogleWhen
  extendedProperties?: { private?: Record<string, string> }
  transparency?: 'transparent' | 'opaque'
}

export interface GoogleEventQuery {
  timeMin?: string
  timeMax?: string
  /** Only events changed after this time (ISO). */
  updatedMin?: string
  /** key=value on the event's private properties. */
  privateProp?: string
  showDeleted?: boolean
}

export interface GoogleTokens {
  accessToken: string
  /** Only present the first time a person grants access. */
  refreshToken: string | null
  expiresAt: Date
  email: string | null
}

/** The saved refresh token no longer works (the person revoked access, or it expired). They must connect again. */
export class GoogleAuthError extends Error {}
/** The short-lived access token was rejected: refresh it and try once more. */
export class GoogleUnauthorizedError extends Error {}
/** Any other failure from Google. */
export class GoogleApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message)
  }
}

export interface GoogleClient {
  authUrl(a: { redirectUri: string; state: string }): string
  exchangeCode(a: { code: string; redirectUri: string }): Promise<GoogleTokens>
  refresh(refreshToken: string): Promise<{ accessToken: string; expiresAt: Date }>
  revoke(token: string): Promise<void>
  listEvents(accessToken: string, calendarId: string, query: GoogleEventQuery): Promise<GoogleEvent[]>
  /** null when the event does not exist (any more). */
  getEvent(accessToken: string, calendarId: string, eventId: string): Promise<GoogleEvent | null>
  insertEvent(accessToken: string, calendarId: string, input: GoogleEventInput): Promise<GoogleEvent>
  patchEvent(accessToken: string, calendarId: string, eventId: string, input: GoogleEventInput): Promise<GoogleEvent>
  deleteEvent(accessToken: string, calendarId: string, eventId: string): Promise<void>
}

/** What the server needs to run the feature. Missing in the environment means the feature is off. */
export interface GoogleConfig {
  client: GoogleClient
  redirectUri: string
}

/** Calendar events, plus the person's email address to show which account is connected. */
export const GOOGLE_SCOPES = ['https://www.googleapis.com/auth/calendar.events', 'https://www.googleapis.com/auth/userinfo.email']

const API = 'https://www.googleapis.com/calendar/v3'
const enc = encodeURIComponent

export function createGoogleClient(opts: { clientId: string; clientSecret: string }): GoogleClient {
  async function call(url: string, token: string, init: RequestInit = {}): Promise<Response> {
    const res = await fetch(url, {
      ...init,
      headers: { Authorization: `Bearer ${token}`, ...(init.body ? { 'Content-Type': 'application/json' } : {}) },
      signal: AbortSignal.timeout(15_000),
    })
    if (res.status === 401) throw new GoogleUnauthorizedError('Google rejected the access token.')
    return res
  }
  async function ok<T>(res: Response): Promise<T> {
    if (!res.ok) throw new GoogleApiError(res.status, `Google Calendar answered ${res.status}.`)
    return (await res.json()) as T
  }

  async function tokenRequest(params: Record<string, string>) {
    const res = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: opts.clientId, client_secret: opts.clientSecret, ...params }),
      signal: AbortSignal.timeout(15_000),
    })
    const json = (await res.json().catch(() => ({}))) as { access_token?: string; refresh_token?: string; expires_in?: number; error?: string }
    if (!res.ok || !json.access_token) {
      if (json.error === 'invalid_grant') throw new GoogleAuthError('invalid_grant')
      throw new GoogleApiError(res.status, `Google sign-in answered ${res.status}.`)
    }
    return json as Required<Pick<typeof json, 'access_token'>> & typeof json
  }

  return {
    authUrl: ({ redirectUri, state }) =>
      'https://accounts.google.com/o/oauth2/v2/auth?' +
      new URLSearchParams({
        client_id: opts.clientId,
        redirect_uri: redirectUri,
        response_type: 'code',
        scope: GOOGLE_SCOPES.join(' '),
        access_type: 'offline',
        prompt: 'consent',
        include_granted_scopes: 'true',
        state,
      }).toString(),

    async exchangeCode({ code, redirectUri }) {
      const t = await tokenRequest({ grant_type: 'authorization_code', code, redirect_uri: redirectUri })
      let email: string | null = null
      try {
        const who = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', { headers: { Authorization: `Bearer ${t.access_token}` }, signal: AbortSignal.timeout(10_000) })
        if (who.ok) email = ((await who.json()) as { email?: string }).email ?? null
      } catch {
        // the email is only a label
      }
      return { accessToken: t.access_token, refreshToken: t.refresh_token ?? null, expiresAt: new Date(Date.now() + (t.expires_in ?? 3600) * 1000), email }
    },

    async refresh(refreshToken) {
      const t = await tokenRequest({ grant_type: 'refresh_token', refresh_token: refreshToken })
      return { accessToken: t.access_token, expiresAt: new Date(Date.now() + (t.expires_in ?? 3600) * 1000) }
    },

    async revoke(token) {
      await fetch('https://oauth2.googleapis.com/revoke', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ token }),
        signal: AbortSignal.timeout(10_000),
      })
    },

    async listEvents(token, calendarId, q) {
      const out: GoogleEvent[] = []
      let pageToken: string | undefined
      for (let page = 0; page < 6; page++) {
        const params = new URLSearchParams({ maxResults: '250', singleEvents: 'true' })
        if (q.timeMin) params.set('timeMin', q.timeMin)
        if (q.timeMax) params.set('timeMax', q.timeMax)
        if (q.updatedMin) params.set('updatedMin', q.updatedMin)
        if (q.privateProp) params.set('privateExtendedProperty', q.privateProp)
        if (q.showDeleted) params.set('showDeleted', 'true')
        if (pageToken) params.set('pageToken', pageToken)
        const json = await ok<{ items?: GoogleEvent[]; nextPageToken?: string }>(await call(`${API}/calendars/${enc(calendarId)}/events?${params}`, token))
        out.push(...(json.items ?? []))
        pageToken = json.nextPageToken
        if (!pageToken) break
      }
      return out
    },

    async getEvent(token, calendarId, eventId) {
      const res = await call(`${API}/calendars/${enc(calendarId)}/events/${enc(eventId)}`, token)
      if (res.status === 404 || res.status === 410) return null
      const event = await ok<GoogleEvent>(res)
      return event.status === 'cancelled' ? null : event
    },

    async insertEvent(token, calendarId, input) {
      return ok<GoogleEvent>(await call(`${API}/calendars/${enc(calendarId)}/events`, token, { method: 'POST', body: JSON.stringify(input) }))
    },

    async patchEvent(token, calendarId, eventId, input) {
      return ok<GoogleEvent>(await call(`${API}/calendars/${enc(calendarId)}/events/${enc(eventId)}`, token, { method: 'PATCH', body: JSON.stringify(input) }))
    },

    async deleteEvent(token, calendarId, eventId) {
      const res = await call(`${API}/calendars/${enc(calendarId)}/events/${enc(eventId)}`, token, { method: 'DELETE' })
      if (res.status === 404 || res.status === 410) return
      if (!res.ok) throw new GoogleApiError(res.status, `Google Calendar answered ${res.status}.`)
    },
  }
}
