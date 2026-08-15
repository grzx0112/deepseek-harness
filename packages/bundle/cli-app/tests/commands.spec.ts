/** Slash-command grammar and the help listing. */

import { describe, expect, it } from 'vitest'
import { COMMANDS, helpText, parseCommand } from '../src/commands.ts'
import { TuiStore } from '../src/store.ts'

describe('parseCommand', () => {
  it('parses name and args', () => {
    expect(parseCommand('/model')).toEqual({ name: 'model', args: '' })
    expect(parseCommand('/resume session-abc')).toEqual({ name: 'resume', args: 'session-abc' })
    expect(parseCommand('/resume   session-abc ')).toEqual({ name: 'resume', args: 'session-abc' })
  })

  it('returns undefined for ordinary prompts and bare slashes', () => {
    expect(parseCommand('hello')).toBeUndefined()
    expect(parseCommand('/')).toBeUndefined()
    expect(parseCommand('   ')).toBeUndefined()
  })
})

describe('helpText', () => {
  it('lists every command with aligned columns', () => {
    const rows = helpText()
    expect(rows).toHaveLength(COMMANDS.length)
    expect(rows.some(row => row.includes('/model'))).toBe(true)
  })
})

describe('TuiStore', () => {
  it('publishes snapshots to subscribers', () => {
    const store = new TuiStore()
    const seen: string[] = []
    const unsubscribe = store.subscribe(() => { seen.push(store.get().tail) })
    store.set({ tail: 'a' })
    store.pushItems([{ kind: 'user', text: 'q' }])
    expect(seen).toEqual(['a', 'a'])
    expect(store.get().items).toEqual([{ kind: 'user', text: 'q' }])
    unsubscribe()
    store.set({ tail: 'b' })
    expect(seen).toEqual(['a', 'a'])
  })
})
