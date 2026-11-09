import { simulateReadableStream } from 'ai'
import { MockLanguageModelV4 } from 'ai/test'
import type { ModelFactory } from './lib/models.ts'

const usage = {
  inputTokens: { total: 5, noCache: 5, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: 5, text: 5, reasoning: undefined },
}

type Part = { type: string; text?: string; toolName?: string; output?: { type?: string; value?: unknown } }
type Msg = { role: string; content: Part[] | string }

/**
 * A fake model for local browser tests (MOCK_AI=1). No network, no key needed.
 * "add a task: X" makes it call create_task, then it confirms in plain text. "Plan my day", "Summarize my day" and
 * "Weekly review" call Tempo's briefing tools and repeat one fact from the result. "delete the task X" calls
 * delete_task (which asks the person first). "which task" asks the person a question (ask_user). Anything else is echoed.
 */
export const mockModelFactory: ModelFactory = () =>
  new MockLanguageModelV4({
    doStream: async (options) => {
      const prompt = options.prompt as unknown as Msg[]
      const last = prompt[prompt.length - 1]
      const userText = [...prompt]
        .reverse()
        .find((m) => m.role === 'user')
      const text = Array.isArray(userText?.content) ? userText.content.map((p) => p.text ?? '').join(' ') : String(userText?.content ?? '')

      const briefing = /plan my day/i.test(text) ? 'plan_day' : /summari[sz]e my day/i.test(text) ? 'daily_summary' : /weekly review/i.test(text) ? 'weekly_review' : null
      const result = Array.isArray(last.content) ? last.content.find((p) => p.type === 'tool-result') : undefined
      const value = (result?.output?.value ?? {}) as { tracked?: string; tasks?: { title: string }[] }
      const answer = (result?.output?.value ?? {}) as { answer?: string; error?: string }
      const reply =
        result?.output?.type === 'execution-denied'
          ? 'OK, I left it as it is.'
          : result?.toolName === 'delete_task'
            ? answer.error ? 'I could not: ' + answer.error : 'Deleted.'
            : result?.toolName === 'ask_user'
              ? 'You picked: ' + answer.answer + '.'
              : result?.toolName === 'plan_day'
          ? `Your plan. First: ${value.tasks?.[0]?.title ?? 'nothing due'}.`
          : result?.toolName === 'daily_summary'
            ? `Your day: ${value.tracked} tracked.`
            : result?.toolName === 'weekly_review'
              ? `Your week: ${value.tracked} tracked.`
              : 'Done. I added that to your tasks.'

      const chunks =
        last.role === 'tool'
          ? [
              { type: 'text-start', id: 't1' },
              { type: 'text-delta', id: 't1', delta: reply },
              { type: 'text-end', id: 't1' },
              { type: 'finish', finishReason: { unified: 'stop', raw: undefined }, logprobs: undefined, usage },
            ]
          : briefing
            ? [
                { type: 'tool-call', toolCallId: 'mock-1', toolName: briefing, input: '{}' },
                { type: 'finish', finishReason: { unified: 'tool-calls', raw: undefined }, logprobs: undefined, usage },
              ]
          : /delete the task\s+(.+)/i.test(text)
            ? [
                { type: 'tool-call', toolCallId: 'mock-del', toolName: 'delete_task', input: JSON.stringify({ task: text.match(/delete the task\s+(.+)/i)![1].trim() }) },
                { type: 'finish', finishReason: { unified: 'tool-calls', raw: undefined }, logprobs: undefined, usage },
              ]
          : /which task/i.test(text)
            ? [
                { type: 'tool-call', toolCallId: 'mock-ask', toolName: 'ask_user', input: JSON.stringify({ question: 'Which task do you mean?', options: ['Q3 report', 'Send report to Sam'] }) },
                { type: 'finish', finishReason: { unified: 'tool-calls', raw: undefined }, logprobs: undefined, usage },
              ]
          : /add a task:\s*(.+)/i.test(text)
            ? [
                { type: 'tool-call', toolCallId: 'mock-1', toolName: 'create_task', input: JSON.stringify({ title: text.match(/add a task:\s*(.+)/i)![1].trim() }) },
                { type: 'finish', finishReason: { unified: 'tool-calls', raw: undefined }, logprobs: undefined, usage },
              ]
            : [
                { type: 'text-start', id: 't1' },
                { type: 'text-delta', id: 't1', delta: `You said: ${text}` },
                { type: 'text-end', id: 't1' },
                { type: 'finish', finishReason: { unified: 'stop', raw: undefined }, logprobs: undefined, usage },
              ]
      return { stream: simulateReadableStream({ chunks: chunks as never }) }
    },
  })
