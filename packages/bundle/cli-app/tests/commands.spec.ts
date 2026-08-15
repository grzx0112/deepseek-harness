/** Slash-command grammar and the help listing. */

import { describe, expect, it } from 'vitest'
import { COMMANDS, helpText, parseCommand } from '../src/commands.ts'
import { TuiStore, filterOverlayRows } from '../src/store.ts'

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

describe('filterOverlayRows', () => {
  const rows = [
    { provider: 'glm', model: 'glm-5.3', name: 'GLM-5.3' },
    { provider: 'opencode', model: 'claude-sonnet-5', name: undefined },
    { provider: 'opencode', model: 'glm-5.2', name: undefined },
  ]
  const fields = (row: { provider: string; model: string; name?: string }) => [row.provider, row.model, row.name ?? '']

  it('passes everything through on an empty query', () => {
    expect(filterOverlayRows(rows, '', fields)).toHaveLength(3)
    expect(filterOverlayRows(rows, '   ', fields)).toHaveLength(3)
  })

  it('matches case-insensitively across provider, model, and name', () => {
    expect(filterOverlayRows(rows, 'GLM', fields)).toHaveLength(2)
    expect(filterOverlayRows(rows, 'claude', fields)).toHaveLength(1)
    expect(filterOverlayRows(rows, 'GLM-5.3', fields)).toHaveLength(1)
  })

  it('requires every whitespace token to match somewhere', () => {
    expect(filterOverlayRows(rows, 'opencode glm', fields)).toHaveLength(1)
    expect(filterOverlayRows(rows, 'opencode claude', fields)).toHaveLength(1)
    expect(filterOverlayRows(rows, 'opencode nothing', fields)).toHaveLength(0)
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
