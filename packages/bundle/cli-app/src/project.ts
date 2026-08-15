/**
 * Pure projection from durable session events to terminal chat items. No
 * React, no Ink, no Cordis — the tests cover this module alone and the UI
 * renders whatever it produces.
 * @module @deepseek-ai/dsh-cli-app/project
 */

import type { SessionEvent } from '@deepseek-ai/dsh-session'
// Carries the `command/run` + `command/done` SessionEventMap merge.
import type {} from '@deepseek-ai/dsh-commands/types'

/** One finalized transcript row the terminal renders as history. */
export type ChatItem =
  | { kind: 'user'; text: string }
  | { kind: 'assistant'; text: string }
  | { kind: 'reasoning'; text: string }
  | { kind: 'tool-call'; name: string; args: string }
  | { kind: 'tool-result'; callId: string; text: string; isError: boolean }
  | { kind: 'command-run'; name: string; args: string }
  | { kind: 'command-done'; ok: boolean; text: string }

/** Join an event message's text blocks; empty string when it has none. */
function textOf(content: readonly { type: string; text?: string }[]): string {
  return content
    .filter(block => block.type === 'text')
    .map(block => block.text ?? '')
    .join('')
}

/** One-line argument digest for a tool-call row: the raw JSON, truncated. */
export function digestArguments(raw: string, max = 120): string {
  const single = raw.replaceAll('\n', ' ').trim()
  return single.length <= max ? single : single.slice(0, max - 1) + '…'
}

/** One-line result digest for a tool-result row: text blocks, truncated. */
export function digestResult(content: readonly { type: string; text?: string }[], max = 200): string {
  const text = textOf(content).trim()
  return text.length <= max ? text : text.slice(0, max - 1) + '…'
}

/**
 * Project one durable event into zero or more transcript rows. Streaming
 * chunks and boundary markers produce nothing here: the live tail renders
 * from the chunk feed, and turn/step bookkeeping is not transcript content.
 * Injected context (`user/message` with a non-human source) is skipped: it
 * was never typed at this terminal.
 * @param event - one session-log entry.
 * @returns the rows the event contributes.
 */
export function itemsFromEvent(event: SessionEvent): ChatItem[] {
  switch (event.type) {
    case 'user/message': {
      if (event.data.source.kind !== 'user') return []
      const text = textOf(event.data.content)
      return text === '' ? [] : [{ kind: 'user', text }]
    }
    case 'assistant/message': {
      const items: ChatItem[] = []
      for (const block of event.data.message.content) {
        if (block.type === 'reasoning' && block.text !== '') items.push({ kind: 'reasoning', text: block.text })
        if (block.type === 'text' && block.text !== '') items.push({ kind: 'assistant', text: block.text })
      }
      return items
    }
    case 'tool/call':
      return [{ kind: 'tool-call', name: event.data.name, args: digestArguments(event.data.arguments) }]
    case 'tool/result': {
      const block = event.data.message.content[0]
      if (block === undefined || block.type !== 'tool-result') return []
      return [{
        kind: 'tool-result',
        callId: String(block.toolCallId),
        text: digestResult(event.data.message.content),
        isError: event.data.error !== undefined,
      }]
    }
    case 'command/run':
      return [{ kind: 'command-run', name: event.data.name, args: event.data.args ?? '' }]
    case 'command/done':
      return [{
        kind: 'command-done',
        ok: event.data.kind === 'success',
        text: event.data.text ?? (event.data.kind === 'success' ? '完成' : '失败'),
      }]
    default:
      return []
  }
}

/**
 * Project a whole loaded log (resume path) into transcript rows. Chunk and
 * boundary events are skipped by {@link itemsFromEvent}; compaction
 * replacement nodes would re-emit shadowed rows only through their own
 * events, so a plain fold stays correct.
 * @param events - the complete session log.
 * @returns the transcript rows for the whole history.
 */
export function itemsFromLog(events: readonly SessionEvent[]): ChatItem[] {
  return events.flatMap(itemsFromEvent)
}

/**
 * Accumulate the live streaming tail from one raw chunk.
 * @param tail - the current accumulated text of the tail.
 * @param chunk - the raw stream chunk off a `assistant/chunk` event.
 * @returns the next tail text.
 */
export function appendChunk(tail: string, chunk: { type: string; text?: string }): string {
  if (chunk.type === 'text-delta') return tail + (chunk.text ?? '')
  return tail
}
