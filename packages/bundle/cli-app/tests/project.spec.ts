/** Event→item projection, digests, and the live chunk tail accumulation. */

import { describe, expect, it } from 'vitest'
import { CallId, createAssistantMessage, createUserMessage } from '@deepseek-ai/dsh-llm'
import { Session, SessionId, type SessionEvent } from '@deepseek-ai/dsh-session'
import { appendChunk, digestArguments, digestResult, itemsFromEvent, itemsFromLog } from '../src/project.ts'

function newSession(): Session {
  return Session.create(SessionId('session-test'))
}

/** The session's first appended event; fails the test when nothing was appended. */
function firstEvent(session: Session): SessionEvent {
  const event = session.events[0]
  if (event === undefined) throw new Error('no event appended')
  return event
}

describe('itemsFromEvent', () => {
  it('projects a human user message', () => {
    const session = newSession()
    session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: 'hi' }],
      source: { kind: 'user' },
    }), { surfaceOp: 'append' })
    expect(itemsFromEvent(firstEvent(session))).toEqual([{ kind: 'user', text: 'hi' }])
  })

  it('skips injected context with a non-human source', () => {
    const session = newSession()
    session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: 'file changed' }],
      source: { kind: 'model', model: 'other' } as never,
    }), { surfaceOp: 'append' })
    expect(itemsFromEvent(firstEvent(session))).toEqual([])
  })

  it('projects assistant text and reasoning blocks in order', () => {
    const session = newSession()
    session.append('assistant/message', {
      turn: 1,
      step: 1,
      message: createAssistantMessage({
        content: [
          { type: 'reasoning', text: 'thinking...' },
          { type: 'text', text: 'answer' },
        ],
        source: { provider: 'p', model: 'm' },
      }),
    }, { surfaceOp: 'append' })
    expect(itemsFromEvent(firstEvent(session))).toEqual([
      { kind: 'reasoning', text: 'thinking...' },
      { kind: 'assistant', text: 'answer' },
    ])
  })

  it('projects tool calls and results', () => {
    const session = newSession()
    session.append('tool/call', {
      turn: 1, step: 1,
      callId: CallId('call-1'),
      name: 'bash',
      arguments: '{"command":"ls"}',
    })
    expect(itemsFromEvent(firstEvent(session))).toEqual([
      { kind: 'tool-call', name: 'bash', args: '{"command":"ls"}' },
    ])
  })

  it('yields nothing for boundary and chunk events', () => {
    const session = newSession()
    session.append('turn/start', { turn: 1 })
    expect(itemsFromEvent(firstEvent(session))).toEqual([])
  })
})

describe('itemsFromLog', () => {
  it('folds a whole log in order', () => {
    const session = newSession()
    session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: 'q' }],
      source: { kind: 'user' },
    }), { surfaceOp: 'append' })
    session.append('assistant/message', {
      turn: 1, step: 1,
      message: createAssistantMessage({
        content: [{ type: 'text', text: 'a' }],
        source: { provider: 'p', model: 'm' },
      }),
    }, { surfaceOp: 'append' })
    expect(itemsFromLog(session.events)).toEqual([
      { kind: 'user', text: 'q' },
      { kind: 'assistant', text: 'a' },
    ])
  })
})

describe('digests', () => {
  it('truncates long argument JSON to one line', () => {
    expect(digestArguments(`{"a":"${'x'.repeat(200)}"}`, 20)).toHaveLength(20)
    expect(digestArguments('{"a":\n1}')).toBe('{"a": 1}')
  })

  it('truncates long tool results', () => {
    expect(digestResult([{ type: 'text', text: 'y'.repeat(300) }], 50)).toHaveLength(50)
  })
})

describe('appendChunk', () => {
  it('accumulates text deltas and ignores other chunk types', () => {
    expect(appendChunk('', { type: 'text-delta', text: 'he' })).toBe('he')
    expect(appendChunk('he', { type: 'text-delta', text: 'llo' })).toBe('hello')
    expect(appendChunk('hello', { type: 'usage' })).toBe('hello')
  })
})
