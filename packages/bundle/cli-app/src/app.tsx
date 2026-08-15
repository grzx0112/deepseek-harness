/**
 * The interactive terminal surface: one Ink application over the runner's
 * observable store. Finalized transcript rows render through <Static> into
 * the terminal's native scrollback; only the live tail, notice, overlay, and
 * composer repaint. Interaction patterns follow the classic terminal-chat
 * layout (immutable history + active bottom region).
 * @module @deepseek-ai/dsh-cli-app/app
 */

import React, { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { Box, render, Static, Text, useApp, useInput } from 'ink'
import type { TuiActions } from './actions.ts'
import { TuiStore } from './store.ts'
import type { ChatItem } from './project.ts'

/** One spinner frame sequence for the running indicator. */
const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'] as const

/** Render one finalized transcript row. */
function ItemView({ item }: { item: ChatItem }): React.JSX.Element {
  switch (item.kind) {
    case 'user':
      return (
        <Box marginTop={1}>
          <Text color="cyan" bold>{'> '}</Text>
          <Text>{item.text}</Text>
        </Box>
      )
    case 'assistant':
      return (
        <Box marginTop={1}>
          <Text>{item.text}</Text>
        </Box>
      )
    case 'reasoning':
      return (
        <Box marginTop={1}>
          <Text color="gray" dimColor>{`✻ ${item.text}`}</Text>
        </Box>
      )
    case 'tool-call':
      return (
        <Box marginTop={1}>
          <Text color="magenta">⏵ {item.name}</Text>
          <Text dimColor>{` ${item.args}`}</Text>
        </Box>
      )
    case 'tool-result':
      return (
        <Box>
          <Text color={item.isError ? 'red' : 'green'} dimColor>{item.isError ? '  ✗ ' : '  ✓ '}</Text>
          <Text dimColor>{item.text}</Text>
        </Box>
      )
    case 'command-run':
      return (
        <Box marginTop={1}>
          <Text color="yellow" bold>{`⌘ /${item.name}`}</Text>
          <Text dimColor>{item.args === '' ? '' : ` ${item.args}`}</Text>
        </Box>
      )
    case 'command-done':
      return (
        <Box>
          <Text color={item.ok ? 'green' : 'red'} dimColor>{item.ok ? '  ✓ ' : '  ✗ '}</Text>
          <Text dimColor>{item.text}</Text>
        </Box>
      )
  }
}

/** Running indicator: advances one frame per 80ms while `running`. */
function Spinner({ running }: { running: boolean }): React.JSX.Element {
  const [frame, setFrame] = useState(0)
  useEffect(() => {
    if (!running) return
    const timer = setInterval(() => { setFrame(f => (f + 1) % SPINNER_FRAMES.length) }, 80)
    return () => { clearInterval(timer) }
  }, [running])
  if (!running) return <></>
  return <Text color="green">{SPINNER_FRAMES[frame]} </Text>
}

/** Insert `ch` into `text` at `cursor`, returning text and next cursor. */
function insert(text: string, cursor: number, ch: string): { text: string; cursor: number } {
  return { text: text.slice(0, cursor) + ch + text.slice(cursor), cursor: cursor + ch.length }
}

export interface EditorState {
  text: string
  cursor: number
}

/**
 * The composer: multiline editing with history navigation. Enter submits,
 * Ctrl+J inserts a newline, Up/Down walk history on a single-line draft and
 * move across lines once the draft is multiline.
 */
function Composer(
  { history, active, onSubmit }: { history: readonly string[]; active: boolean; onSubmit(text: string): void },
): React.JSX.Element {
  const [state, setState] = useState<EditorState>({ text: '', cursor: 0 })
  const [historyIndex, setHistoryIndex] = useState<number | null>(null)
  const draftRef = useRef('')
  const activeRef = useRef(active)
  activeRef.current = active
  // The editor state the key handler reads: a ref, so the handler never
  // depends on a stale closure and never needs the setState updater (whose
  // render-phase execution forbids the side effects below).
  const stateRef = useRef(state)
  stateRef.current = state
  const historyIndexRef = useRef(historyIndex)
  historyIndexRef.current = historyIndex

  useEffect(() => {
    // Keep the pre-history draft around so Down can restore it.
    if (historyIndex === null) draftRef.current = state.text
  })

  useInput((input, key) => {
    if (!activeRef.current) return
    const { text, cursor } = stateRef.current
    const apply = (next: EditorState) => {
      stateRef.current = next
      setState(next)
    }
    if (key.return) {
      const trimmed = text.trim()
      if (trimmed !== '') {
        setHistoryIndex(null)
        onSubmit(trimmed)
      }
      apply({ text: '', cursor: 0 })
      return
    }
    if (key.ctrl && input === 'j') {
      apply(insert(text, cursor, '\n'))
      return
    }
    if (key.backspace || key.delete) {
      if (cursor === 0) return
      apply({ text: text.slice(0, cursor - 1) + text.slice(cursor), cursor: cursor - 1 })
      return
    }
    if (key.leftArrow) {
      apply({ text, cursor: Math.max(0, cursor - 1) })
      return
    }
    if (key.rightArrow) {
      apply({ text, cursor: Math.min(text.length, cursor + 1) })
      return
    }
    if (key.upArrow) {
      if (text.includes('\n')) {
        const before = text.lastIndexOf('\n', cursor - 1)
        apply({ text, cursor: before + 1 })
        return
      }
      const next = historyIndexRef.current === null ? history.length - 1 : Math.max(0, historyIndexRef.current - 1)
      const entry = history[next]
      if (entry === undefined) return
      setHistoryIndex(next)
      apply({ text: entry, cursor: entry.length })
      return
    }
    if (key.downArrow) {
      if (text.includes('\n')) {
        const after = text.indexOf('\n', cursor)
        apply({ text, cursor: after === -1 ? text.length : after + 1 })
        return
      }
      const index = historyIndexRef.current
      if (index === null) return
      const next = index + 1
      if (next >= history.length) {
        setHistoryIndex(null)
        apply({ text: draftRef.current, cursor: draftRef.current.length })
        return
      }
      const entry = history[next]
      if (entry === undefined) return
      setHistoryIndex(next)
      apply({ text: entry, cursor: entry.length })
      return
    }
    if (key.ctrl && input === 'a') {
      const before = text.lastIndexOf('\n', cursor - 1)
      apply({ text, cursor: before + 1 })
      return
    }
    if (key.ctrl && input === 'e') {
      const after = text.indexOf('\n', cursor)
      apply({ text, cursor: after === -1 ? text.length : after })
      return
    }
    if (input !== '' && !key.ctrl && !key.meta) {
      apply(insert(text, cursor, input))
    }
  })

  const before = state.text.slice(0, state.cursor)
  const at = state.text.slice(state.cursor, state.cursor + 1)
  const after = state.text.slice(state.cursor + 1)
  return (
    <Box borderStyle="round" borderColor={active ? 'cyan' : 'gray'} paddingX={1}>
      <Text>
        <Text dimColor>{active ? '' : '… busy (Ctrl+C interrupts) '}</Text>
        <Text>{before}</Text>
        <Text inverse>{at === '' ? ' ' : at}</Text>
        <Text>{after}</Text>
      </Text>
    </Box>
  )
}

/** The /model and /sessions overlay list above the composer. */
function OverlayView(
  { title, rows, cursor, render }: {
    title: string
    rows: readonly unknown[]
    cursor: number
    render(row: unknown, index: number): React.JSX.Element
  },
): React.JSX.Element {
  return (
    <Box flexDirection="column" borderStyle="round" borderColor="yellow" paddingX={1}>
      <Text color="yellow" bold>{title}（↑↓ 选择，Enter 确认，Esc 取消）</Text>
      {rows.slice(0, 12).map((row, index) => (
        <Box key={index}>
          <Text color={index === cursor ? 'cyan' : 'gray'}>{index === cursor ? '❯ ' : '  '}</Text>
          {render(row, index)}
        </Box>
      ))}
      {rows.length > 12 && <Text dimColor>… {rows.length - 12} more</Text>}
    </Box>
  )
}

/** The whole terminal application: history, tail, overlay, composer, status. */
function App({ store, actions }: { store: TuiStore; actions: TuiActions }): React.JSX.Element {
  const state = useSyncExternalStore(store.subscribe, store.get)
  const { exit } = useApp()
  const historyRef = useRef<readonly string[]>([])
  const [ctrlCArmed, setCtrlCArmed] = useState(false)

  const overlay = state.overlay
  useInput((input, key) => {
    if (overlay.kind !== 'none') {
      const size = overlay.kind === 'model' || overlay.kind === 'effort' ? overlay.choices.length : overlay.rows.length
      if (key.escape) actions.cancelOverlay()
      else if (key.upArrow) actions.moveOverlay(-1, size)
      else if (key.downArrow) actions.moveOverlay(1, size)
      else if (key.return) actions.confirmOverlay()
      return
    }
    if (key.ctrl && input === 'c') {
      if (ctrlCArmed) {
        exit()
        void actions.exit()
      } else if (state.running) {
        actions.interrupt()
        setCtrlCArmed(true)
        setTimeout(() => { setCtrlCArmed(false) }, 1500)
      } else {
        setCtrlCArmed(true)
        setTimeout(() => { setCtrlCArmed(false) }, 1500)
      }
    }
  })

  const handleSubmit = useCallback((text: string) => {
    historyRef.current = [...historyRef.current, text]
    if (text.startsWith('/')) actions.command(text.trim())
    else actions.prompt(text)
  }, [actions])

  const staticItems = useMemo(() => [...state.items], [state.items])

  return (
    <Box flexDirection="column">
      <Static items={staticItems}>{(item, index) => <ItemView key={index} item={item} />}</Static>
      {state.tail !== '' && (
        <Box marginTop={1}>
          <Text>{state.tail}</Text>
        </Box>
      )}
      {state.running && (
        <Box>
          <Spinner running />
          <Text dimColor> thinking…</Text>
        </Box>
      )}
      {overlay.kind === 'model' && (
        <OverlayView
          title="选择模型"
          rows={overlay.choices}
          cursor={overlay.cursor}
          render={(row) => {
            const choice = row as { provider: string; model: string; name?: string }
            return <Text>{`${choice.provider} / ${choice.model}${choice.name === undefined ? '' : ` — ${choice.name}`}`}</Text>
          }}
        />
      )}
      {overlay.kind === 'effort' && (
        <OverlayView
          title={`选择推理强度 — ${overlay.pending.provider} / ${overlay.pending.model}`}
          rows={overlay.choices}
          cursor={overlay.cursor}
          render={(row) => {
            const choice = row as { id: string; label: string }
            return <Text>{choice.label}</Text>
          }}
        />
      )}
      {overlay.kind === 'sessions' && (
        <OverlayView
          title="选择会话（/resume）"
          rows={overlay.rows}
          cursor={overlay.cursor}
          render={(row) => {
            const entry = row as { id: string; label?: string }
            return <Text>{`${entry.id}${entry.label === undefined ? '' : ` — ${entry.label}`}`}</Text>
          }}
        />
      )}
      {state.notice !== '' && <Text color="yellow">{state.notice}</Text>}
      <Composer history={historyRef.current} active={overlay.kind === 'none' && !state.running} onSubmit={handleSubmit} />
      <Box>
        <Text dimColor>{` ${state.modelLabel === '' ? 'dsh' : state.modelLabel} — /model 切换 · /compact /plan /goal 等命令直通 · /help 全部命令 · /exit 退出`}</Text>
      </Box>
    </Box>
  )
}

/**
 * Mount the terminal application on stdout.
 * @param store - the runner-owned store the UI reads.
 * @param actions - the runner-owned action set the UI calls.
 * @returns the Ink instance; `unmount()` detaches the surface.
 */
export function mountTui(store: TuiStore, actions: TuiActions): { unmount(): void } {
  const instance = render(<App store={store} actions={actions} />, {
    stdout: process.stdout,
    stdin: process.stdin,
    exitOnCtrlC: false,
  })
  return instance
}
