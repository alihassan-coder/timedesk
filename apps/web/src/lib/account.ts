import { timeEntriesCsv, toDateKey } from '@timedesk/shared'
import { discardPending, getState, resetStore, syncNow } from '@/data/store'
import { resetChats } from '@/features/assistant/chat-store'
import { api, ApiError } from '@/lib/api'
import { API_URL, authHeaders, forgetProfile, signOut } from '@/lib/auth-client'
import { resetAi } from '@/lib/ai/server'
import { clearAllCaches } from '@/lib/cache'
import { stopSettingsSync } from '@/lib/settings-sync'

/** Saves text as a file. In the desktop app this opens the usual "Save as" dialog. */
export function downloadFile(name: string, content: string | Blob, type = 'application/octet-stream') {
  const blob = content instanceof Blob ? content : new Blob([content], { type })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}

/** Downloads everything stored for the signed-in person as one JSON file. */
export async function exportAllData() {
  const res = await fetch(`${API_URL}/v1/account/export`, { credentials: 'include', headers: authHeaders() })
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string }
    throw new ApiError(res.status, body.error ?? 'Could not export your data.')
  }
  downloadFile(`timedesk-export-${toDateKey(Date.now())}.json`, await res.blob(), 'application/json')
}

/** Downloads tracked time as a spreadsheet (CSV), in this device's local time. */
export function exportTimeCsv() {
  const { entries, projects, tasks } = getState()
  // The byte order mark makes Excel read the file as UTF-8, so names with accents or emoji stay intact.
  downloadFile(`timedesk-time-${toDateKey(Date.now())}.csv`, '﻿' + timeEntriesCsv(entries, projects, tasks), 'text/csv;charset=utf-8')
}

/** Forgets everything about the signed-in person on this device: data, chats, AI choices, caches. */
export function clearLocalSession() {
  forgetProfile()
  resetStore()
  resetAi()
  resetChats()
  stopSettingsSync()
  clearAllCaches()
}

/** Signs out and clears this device. */
export async function signOutHere() {
  // Send changes that are still waiting first (a few seconds at most). Anything left stays saved on this device and
  // goes out the next time this person signs in here.
  await Promise.race([syncNow(), new Promise((r) => setTimeout(r, 4000))])
  try {
    await signOut()
  } catch {
    // offline: this device still signs out
  } finally {
    clearLocalSession()
  }
}

/**
 * A message for the sign-in page, for example after the account was deleted. Kept in memory, not in the router state,
 * because the redirect that follows a lost session replaces that. A reload forgets it.
 */
let loginNotice = ''
export const setLoginNotice = (text: string) => {
  loginNotice = text
}
export const getLoginNotice = () => loginNotice

/** Deletes the account for good. Throws ApiError (for example a wrong password). */
export async function deleteAccount(password: string) {
  await api('/account', { method: 'DELETE', body: { password } })
  setLoginNotice('Your account and all its data were deleted.')
  discardPending()
  // The session is already gone on the server, so signing out there may fail. Clearing this device must not.
  try {
    await signOut()
  } catch {
    // ignore
  }
  clearLocalSession()
}
