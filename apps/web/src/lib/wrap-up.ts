/** Days already wrapped up, on this device (the dashboard stops suggesting it). */
const doneKey = (userId: string) => `timedesk:wrapped:${userId}`
export function wrappedUp(userId: string, day: string): boolean {
  try {
    return localStorage.getItem(doneKey(userId)) === day
  } catch {
    return false
  }
}
export function markWrapped(userId: string, day: string) {
  try {
    localStorage.setItem(doneKey(userId), day)
  } catch {
    // storage blocked: the dashboard keeps offering the wrap-up, nothing worse
  }
}

