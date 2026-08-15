/**
 * The terminal app's observable store: one mutable snapshot of transcript,
 * live tail, status, overlay, and notice state, published to React through
 * `useSyncExternalStore`. Owned by the runner; the UI only reads it.
 * @module @deepseek-ai/dsh-cli-app/store
 */

import type { ChatItem } from './project.ts'

/** One selectable model row in the /model overlay. */
export interface ModelChoice {
  provider: string
  model: string
  /** Human label from the adapter catalog when it has one. */
  name: string | undefined
}

/** One selectable reasoning-effort row in the second /model stage. */
export interface EffortChoice {
  /** Opaque adapter-owned effort id passed back as `reasoningEffort`. */
  id: import('@deepseek-ai/dsh-llm').ReasoningEffortId
  /** Human label for the row. */
  label: string
}

/** One row in the /sessions overlay. */
export interface SessionRow {
  id: string
  /** Short first-prompt digest, when the header projection carries one. */
  label: string | undefined
}

/** Which modal overlay (if any) sits above the composer. */
export type Overlay =
  | { kind: 'none' }
  | { kind: 'model'; choices: ModelChoice[]; cursor: number }
  | { kind: 'effort'; pending: { provider: string; model: string }; choices: EffortChoice[]; cursor: number }
  | { kind: 'sessions'; rows: SessionRow[]; cursor: number }

/** Immutable snapshot the UI renders. */
export interface TuiState {
  /** Finalized transcript rows (Ink <Static> history). */
  items: readonly ChatItem[]
  /** Live streaming assistant text tail below the history. */
  tail: string
  /** Whether the agent driver owes work. */
  running: boolean
  /** Current provider/model/effort selection label. */
  modelLabel: string
  /** The overlay above the composer. */
  overlay: Overlay
  /** Transient single-line notice (command feedback, errors). */
  notice: string
}

/**
 * Minimal observable store: `get` returns an immutable snapshot, `set`
 * publishes the next one to every subscriber. The runner is the only writer.
 */
export class TuiStore {
  private state: TuiState = {
    items: [],
    tail: '',
    running: false,
    modelLabel: '',
    overlay: { kind: 'none' },
    notice: '',
  }
  private readonly listeners = new Set<() => void>()

  /** @returns the current immutable snapshot; bound, so it survives being passed as a callback. */
  get = (): TuiState => {
    return this.state
  }

  /** Subscribe to snapshot publications; returns the unsubscribe function. */
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  /** Replace the snapshot and publish it. */
  set(patch: Partial<TuiState>): void {
    this.state = { ...this.state, ...patch }
    for (const listener of this.listeners) listener()
  }

  /** Append finalized transcript rows. */
  pushItems(items: readonly ChatItem[]): void {
    if (items.length === 0) return
    this.set({ items: [...this.state.items, ...items] })
  }
}
