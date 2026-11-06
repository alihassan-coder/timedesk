/**
 * The ready-made questions behind Tempo's daily summary, weekly review and "plan my day". Buttons elsewhere in the
 * app open the assistant with one of these, and it is sent at once in a new chat.
 */
export const TEMPO_PROMPTS = {
  day: 'Summarize my day',
  week: 'Weekly review',
  plan: 'Plan my day',
} as const

/** A link that opens Tempo in a new chat and sends `prompt`. */
export const askTempoLink = (prompt: string) => `/assistant?ask=${encodeURIComponent(prompt)}`

/** The person's time zone, sent with every message so Tempo knows their "today". */
export const timeZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone
