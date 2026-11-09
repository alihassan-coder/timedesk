import {
  GoogleApiError,
  GoogleAuthError,
  GoogleUnauthorizedError,
  type GoogleClient,
  type GoogleEvent,
  type GoogleEventInput,
  type GoogleWhen,
} from './google.ts'

/**
 * An in-memory Google for tests and for the no-database dev server (FAKE_GOOGLE=1). It behaves like the
 * parts of Google Calendar timedesk uses: sign-in codes, refresh tokens that can be revoked, access
 * tokens that expire, events with etags and update times, deleted events that stay as "cancelled".
 *
 * A sign-in code "code-ann" connects the Google account ann@gmail.test.
 */
export function createFakeGoogle() {
  const events = new Map<string, Map<string, GoogleEvent>>() // email -> event id -> event
  const revokedRefresh = new Set<string>()
  const validAccess = new Map<string, string>() // access token -> email
  const log: string[] = []
  let counter = 0
  let refreshes = 0

  const calendarOf = (email: string) => {
    let m = events.get(email)
    if (!m) events.set(email, (m = new Map()))
    return m
  }
  let lastStamp = 0
  /** Real time, but always later than the previous stamp, so "updated" orders changes even within one millisecond. */
  const stamp = () => new Date((lastStamp = Math.max(lastStamp + 1, Date.now()))).toISOString()
  const mint = (email: string) => {
    const token = `access-${++counter}-${email}`
    validAccess.set(token, email)
    return { accessToken: token, expiresAt: new Date(Date.now() + 3_600_000) }
  }
  const who = (token: string) => {
    const email = validAccess.get(token)
    if (!email) throw new GoogleUnauthorizedError('expired')
    return email
  }
  const ms = (w?: GoogleWhen) => (w?.dateTime ? Date.parse(w.dateTime) : w?.date ? Date.parse(w.date) : NaN)

  const client: GoogleClient = {
    authUrl: ({ redirectUri, state }) => `${redirectUri}?code=${encodeURIComponent('code-dev')}&state=${encodeURIComponent(state)}`,

    async exchangeCode({ code }) {
      log.push('exchangeCode')
      const m = /^code-(\w+)$/.exec(code)
      if (!m) throw new GoogleApiError(400, 'bad code')
      const email = `${m[1]}@gmail.test`
      return { ...mint(email), refreshToken: `refresh-${email}`, email }
    },

    async refresh(refreshToken) {
      log.push('refresh')
      refreshes++
      const email = refreshToken.replace(/^refresh-/, '')
      if (!refreshToken.startsWith('refresh-') || revokedRefresh.has(refreshToken)) throw new GoogleAuthError('invalid_grant')
      return mint(email)
    },

    async revoke(token) {
      log.push('revoke')
      revokedRefresh.add(token)
    },

    async listEvents(token, _cal, q) {
      log.push('list')
      const email = who(token)
      // Like Google: changes can only be asked for over roughly the last 20 days ("updatedMinTooLongAgo").
      if (q.updatedMin && Date.parse(q.updatedMin) < Date.now() - 20 * 86_400_000) {
        throw new GoogleApiError(410, 'Google Calendar answered 410 (updatedMinTooLongAgo).')
      }
      return [...calendarOf(email).values()].filter((e) => {
        if (e.status === 'cancelled' && !q.showDeleted) return false
        if (q.timeMin && ms(e.end) <= Date.parse(q.timeMin)) return false
        if (q.timeMax && ms(e.start) >= Date.parse(q.timeMax)) return false
        if (q.updatedMin && Date.parse(e.updated ?? '') <= Date.parse(q.updatedMin)) return false
        if (q.privateProp) {
          const [k, v] = q.privateProp.split('=')
          if (e.extendedProperties?.private?.[k] !== v) return false
        }
        return true
      })
    },

    async getEvent(token, _cal, id) {
      log.push('get')
      const e = calendarOf(who(token)).get(id)
      return e && e.status !== 'cancelled' ? e : null
    },

    async insertEvent(token, _cal, input: GoogleEventInput) {
      log.push('insert')
      const email = who(token)
      const id = `evt-${++counter}`
      const e: GoogleEvent = { id, status: 'confirmed', htmlLink: `https://calendar.test/${id}`, etag: `"${counter}"`, updated: stamp(), ...input }
      calendarOf(email).set(id, e)
      return e
    },

    async patchEvent(token, _cal, id, input) {
      log.push('patch')
      const e = calendarOf(who(token)).get(id)
      if (!e || e.status === 'cancelled') throw new GoogleApiError(404, 'not found')
      Object.assign(e, input, { etag: `"${++counter}"`, updated: stamp() })
      return e
    },

    async deleteEvent(token, _cal, id) {
      log.push('delete')
      const e = calendarOf(who(token)).get(id)
      if (e) Object.assign(e, { status: 'cancelled', etag: `"${++counter}"`, updated: stamp() })
    },
  }

  return {
    client,
    /** Every call the API made, in order, for assertions. */
    log,
    get refreshCount() {
      return refreshes
    },
    /** Live (not deleted) events of one Google account. */
    eventsOf: (email: string) => [...calendarOf(email).values()].filter((e) => e.status !== 'cancelled'),
    /** Put an event straight into someone's Google Calendar, as if they made it in Google. */
    seed(email: string, input: GoogleEventInput): GoogleEvent {
      const id = `evt-${++counter}`
      const e: GoogleEvent = { id, status: 'confirmed', htmlLink: `https://calendar.test/${id}`, etag: `"${counter}"`, updated: stamp(), ...input }
      calendarOf(email).set(id, e)
      return e
    },
    /** Change an event in Google, as if the person edited it there. */
    editInGoogle(email: string, id: string, input: GoogleEventInput) {
      const e = calendarOf(email).get(id)
      if (!e) throw new Error('no such event')
      Object.assign(e, input, { etag: `"${++counter}"`, updated: stamp() })
    },
    deleteInGoogle(email: string, id: string) {
      const e = calendarOf(email).get(id)
      if (e) Object.assign(e, { status: 'cancelled', etag: `"${++counter}"`, updated: stamp() })
    },
    /** The person revoked timedesk's access in their Google account. */
    revokeAccess(email: string) {
      revokedRefresh.add(`refresh-${email}`)
      for (const [t, e] of validAccess) if (e === email) validAccess.delete(t)
    },
    /** Every access token expires (they only last an hour in real life). */
    expireAccessTokens() {
      validAccess.clear()
    },
  }
}

export type FakeGoogle = ReturnType<typeof createFakeGoogle>
