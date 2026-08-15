/**
 * @deepseek-ai/dsh-cli-app — interactive single-session terminal driver. The
 * bundle patch rides over dsh-base without Host, HTTP, or browser plugins;
 * this runner keeps one Agent alive, projects its durable session events
 * into an Ink terminal surface, and routes composer input and slash commands
 * back into the agent.
 *
 * @module @deepseek-ai/dsh-cli-app
 */

import { randomUUID } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { installModelSelection, type ModelSelectionRef } from '@deepseek-ai/dsh-agent'
import type { AgentHandle } from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-agent-default-model'
import { createUserMessage, type ReasoningEffortId } from '@deepseek-ai/dsh-llm'
import { SessionId, type Session, type SessionEvent } from '@deepseek-ai/dsh-session'
import type { SessionHeader } from '@deepseek-ai/dsh-session'
// Empty type imports carry the loader Context merge for the settlement await
// and the cmdline Context merge for the appExit host value.
import type {} from '@deepseek-ai/cordis-plugin-loader'
import type {} from '@deepseek-ai/dsh-cmdline'
import type { TuiActions } from './actions.ts'
import { mountTui } from './app.tsx'
import { helpText, parseCommand } from './commands.ts'
import { appendChunk, itemsFromEvent, itemsFromLog } from './project.ts'
import { TuiStore } from './store.ts'
import type { ModelChoice, SessionRow } from './store.ts'

/** Stable Cordis plugin name. */
export const name = 'cli-runner'

/** Core services required before the interactive surface can start. */
export const inject = ['agentDefaultModel', 'agents', 'sessions', 'llm']

/** Plugin config: startup values resolved from this app's injected provider service. */
export interface Config {
  /** Persisted session id to resume, or undefined for a fresh session. */
  resumeSessionId?: string
}

export const Config: z<Config> = z.object({
  resumeSessionId: z.string(),
})

/**
 * Mount the interactive terminal driver.
 * @param ctx - plugin context carrying core services and the launcher-provided exit request.
 * @param config - validated startup config.
 */
export function apply(ctx: Context, config: Config): void {
  // Read through the global service store, not the property proxy: appExit is
  // an optional host value, never an injected dependency.
  const exitRequest = ctx.get('appExit')
  if (exitRequest === undefined) {
    throw new Error('cli-runner: the launcher must provide ctx.appExit before the tree mounts')
  }

  const store = new TuiStore()
  const runner = new Runner(ctx, store, exitRequest)
  const tui = mountTui(store, runner.actions())
  ctx.effect(() => () => { tui.unmount() }, 'cli-runner:tui')
  void runner.start(config.resumeSessionId).catch((error: unknown) => {
    process.stderr.write(`dsh: ${error instanceof Error ? error.message : String(error)}\n`)
    tui.unmount()
    exitRequest(1)
  })
}

/**
 * The driver: owns the live agent handle, translates session events into
 * store publications, and executes the surface's actions.
 */
class Runner {
  private handle: AgentHandle | undefined
  private selection: ModelSelectionRef = { current: undefined, assembled: undefined }
  private disposed = false

  constructor(
    private readonly ctx: Context,
    private readonly store: TuiStore,
    private readonly exitRequest: (code: number) => void,
  ) {
    // One global listener serves every live agent: the session filter makes
    // /new and /resume rebinds transparent to the projection.
    this.ctx.on('session/event', (session: Session, event: SessionEvent) => {
      if (session.id !== this.handle?.agent.session.id) return
      this.onEvent(session, event)
    })
  }

  /** The action set the Ink surface calls. */
  actions(): TuiActions {
    return {
      prompt: (text) => { void this.submit(text) },
      command: (line) => { void this.command(line) },
      interrupt: () => { this.interrupt() },
      exit: () => this.exit(),
      cancelOverlay: () => { this.store.set({ overlay: { kind: 'none' } }) },
      moveOverlay: (delta, size) => { this.moveOverlay(delta, size) },
      confirmOverlay: () => { void this.confirmOverlay() },
    }
  }

  /** Boot the first agent: resume when asked, else create fresh. */
  async start(resumeSessionId: string | undefined): Promise<void> {
    await this.ctx.get('loader')?.await()
    await this.bootAgent(resumeSessionId)
  }

  /** Create or resume the agent and project its whole log into the surface. */
  private async bootAgent(resumeSessionId: string | undefined): Promise<void> {
    const agents = this.ctx.get('agents')
    const defaultModel = this.ctx.get('agentDefaultModel')
    if (agents === undefined || defaultModel === undefined) return
    const current = defaultModel.currentSelection()
    if (current === undefined) throw new Error('cli-runner: no default model is configured (set agent-default-model or the settings selection)')
    this.selection = { current, assembled: undefined }
    const setup = (agentCtx: Context) => { installModelSelection(agentCtx, this.selection) }
    const agentOptions = { provider: current.provider, model: current.model }
    this.handle = resumeSessionId === undefined
      ? await agents.create({
        sessionId: SessionId(`session-${randomUUID()}`),
        meta: { cwd: process.cwd() },
        agentOptions,
        setup,
      })
      : await agents.resume({
        resumeSessionId: SessionId(resumeSessionId),
        agentOptions,
        setup,
      })
    if (this.disposed) return
    this.store.set({
      items: itemsFromLog(this.handle.agent.session.events),
      tail: '',
      running: false,
      modelLabel: this.modelLabel(),
      overlay: { kind: 'none' },
      notice: '',
    })
  }

  /** Publish one durable event into transcript/tail/status state. */
  private onEvent(session: Session, event: SessionEvent): void {
    switch (event.type) {
      case 'turn/start':
        this.store.set({ running: true })
        break
      case 'turn/end':
        this.store.set({ running: false })
        void this.ctx.sessions.flush(session).catch(() => { /* persistence failures already log at their owner */ })
        break
      case 'assistant/chunk':
        if (event.data.chunk.type === 'text-delta') {
          this.store.set({ tail: appendChunk(this.store.get().tail, event.data.chunk) })
        }
        break
      case 'assistant/message':
        this.store.pushItems(itemsFromEvent(event))
        this.store.set({ tail: '' })
        break
      default:
        this.store.pushItems(itemsFromEvent(event))
    }
  }

  /** Submit one human prompt; the durable `user/message` echoes it. */
  private async submit(text: string): Promise<void> {
    const handle = this.handle
    if (handle === undefined) return
    handle.agent.followup(createUserMessage({
      content: [{ type: 'text', text }],
      source: { kind: 'user' },
    }))
  }

  /** Cancel the running turn, keeping any queued inbox work. */
  private interrupt(): void {
    this.handle?.agent.cancel({ kind: 'user' }, { keepInbox: true })
    this.store.set({ notice: '已中断当前回合', running: false })
  }

  /** Execute one leading-slash command line. */
  private async command(line: string): Promise<void> {
    const parsed = parseCommand(line)
    if (parsed === undefined) return
    switch (parsed.name) {
      case 'help':
        await this.showHelp()
        break
      case 'exit':
        await this.exit()
        break
      case 'interrupt':
        this.interrupt()
        break
      case 'new':
        await this.reboot(undefined)
        break
      case 'resume':
        if (parsed.args === '') {
          await this.openSessions()
        } else {
          await this.reboot(parsed.args)
        }
        break
      case 'sessions':
        await this.openSessions()
        break
      case 'model':
        await this.openModelPicker()
        break
      case 'export':
        await this.exportLog(parsed.args)
        break
      default:
        await this.dispatchHostCommand(line, parsed.name)
    }
  }

  /** /help: the local table merged with every host-registered command. */
  private async showHelp(): Promise<void> {
    const host = this.listHostCommands()
    this.store.set({ notice: '' })
    this.store.pushItems(helpText(host).map(text => ({ kind: 'user' as const, text: `  ${text}` })))
  }

  /** Host command descriptors for the live agent, when the registry is mounted. */
  private listHostCommands(): readonly { name: string; description: string }[] {
    const commands = this.ctx.get('commands')
    const agent = this.handle?.agent
    if (commands === undefined || agent === undefined) return []
    try {
      return commands.list(agent)
    } catch {
      return []
    }
  }

  /**
   * Execute one slash line through the host command registry — the same
   * registry the web composer dispatches through, so every host command
   * (`/compact`, `/plan`, `/goal`, `/feedback`, `/permission`, …) works here
   * with identical semantics, and its `command/run`/`command/done` lifecycle
   * renders in the transcript through the projection.
   */
  private async dispatchHostCommand(line: string, name: string): Promise<void> {
    const commands = this.ctx.get('commands')
    const agent = this.handle?.agent
    if (commands === undefined || agent === undefined) {
      this.store.set({ notice: `未知命令 ${name}（/help 查看）` })
      return
    }
    if (commands.find(agent, name) === undefined) {
      this.store.set({ notice: `未知命令 ${name}（/help 查看）` })
      return
    }
    try {
      const execution = await commands.execute(agent, line, new AbortController().signal)
      if (execution === undefined) {
        this.store.set({ notice: `命令 ${name} 未能解析` })
        return
      }
      if (execution.result.kind === 'error') {
        this.store.set({ notice: `/${name} 失败：${execution.result.text}` })
      } else if (execution.result.text !== undefined && execution.result.text !== '') {
        this.store.set({ notice: `/${name}：${execution.result.text}` })
      } else {
        this.store.set({ notice: '' })
      }
    } catch (error: unknown) {
      this.store.set({ notice: `/${name} 执行出错：${error instanceof Error ? error.message : String(error)}` })
    }
  }

  /** /export: write the raw persisted log (JSONL text) beside the cwd. */
  private async exportLog(args: string): Promise<void> {
    const persistence = this.ctx.get('sessionPersistence')
    const session = this.handle?.agent.session
    if (persistence === undefined || session === undefined) {
      this.store.set({ notice: '会话持久化未配置，无法导出' })
      return
    }
    if (!persistence.supportsRawArtifacts) {
      this.store.set({ notice: '当前持久化后端不支持原始日志导出' })
      return
    }
    try {
      await this.ctx.sessions.flush(session)
      const artifact = await persistence.readRaw(session.id)
      if (artifact === undefined) {
        this.store.set({ notice: '会话尚未落盘（先发送一条消息再导出）' })
        return
      }
      const target = args !== ''
        ? args
        : `${String(session.id).slice(0, 'session-'.length + 8)}-${new Date().toISOString().replaceAll(':', '')}.jsonl`
      const path = await import('node:path').then(path => path.resolve(process.cwd(), target))
      const { writeFile } = await import('node:fs/promises')
      await writeFile(path, artifact.content, 'utf8')
      this.store.set({ notice: `已导出 → ${path}` })
    } catch (error: unknown) {
      this.store.set({ notice: `导出失败：${error instanceof Error ? error.message : String(error)}` })
    }
  }

  /** Dispose the live agent and boot a fresh or resumed one. */
  private async reboot(resumeSessionId: string | undefined): Promise<void> {
    const previous = this.handle
    this.handle = undefined
    this.store.set({ notice: resumeSessionId === undefined ? '新会话…' : `恢复 ${resumeSessionId}…` })
    if (previous !== undefined) await previous.dispose().catch(() => { /* the new boot reports its own failures */ })
    try {
      await this.bootAgent(resumeSessionId)
      this.store.set({ notice: '' })
    } catch (error: unknown) {
      // A failed resume falls back to the previous selection: surface the
      // failure, then boot fresh so the terminal never dead-ends.
      this.store.set({ notice: `恢复失败：${error instanceof Error ? error.message : String(error)}` })
      await this.bootAgent(undefined)
    }
  }

  /** Load every provider's models and open the /model overlay. */
  private async openModelPicker(): Promise<void> {
    const llm = this.ctx.get('llm')
    if (llm === undefined) {
      this.store.set({ notice: 'llm 服务不可用' })
      return
    }
    const choices: ModelChoice[] = []
    for (const provider of llm.listProviders()) {
      const models = await llm.listModels(provider.id).catch(() => [])
      for (const model of models) {
        choices.push({ provider: provider.id, model: model.id, name: model.name })
      }
    }
    if (choices.length === 0) {
      this.store.set({ notice: '没有可配置的模型路由' })
      return
    }
    const current = this.selection.current
    const cursor = Math.max(0, choices.findIndex(choice =>
      current !== undefined && choice.provider === current.provider && choice.model === current.model))
    this.store.set({ overlay: { kind: 'model', choices, cursor } })
  }

  /** List persisted sessions and open the /sessions overlay. */
  private async openSessions(): Promise<void> {
    const persistence = this.ctx.get('sessionPersistence')
    if (persistence === undefined) {
      this.store.set({ notice: '会话持久化未配置' })
      return
    }
    const headers = await persistence.list().catch((error: unknown) => {
      this.store.set({ notice: `会话列表读取失败：${error instanceof Error ? error.message : String(error)}` })
      return [] as SessionHeader[]
    })
    const rows: SessionRow[] = headers
      .slice()
      .sort((a: SessionHeader, b: SessionHeader) => b.createdAt - a.createdAt)
      .map((header: SessionHeader) => ({
        id: header.id,
        label: `${new Date(header.createdAt).toLocaleString()}${header.cwd === undefined ? '' : ` · ${header.cwd}`}`,
      }))
    if (rows.length === 0) {
      this.store.set({ notice: '没有持久化会话' })
      return
    }
    this.store.set({ overlay: { kind: 'sessions', rows, cursor: 0 } })
  }

  /** Move the open overlay cursor, clamped to its rows. */
  private moveOverlay(delta: number, size: number): void {
    const overlay = this.store.get().overlay
    if (overlay.kind === 'none' || size <= 0) return
    this.store.set({ overlay: { ...overlay, cursor: Math.min(size - 1, Math.max(0, overlay.cursor + delta)) } })
  }

  /** Act on the overlay row under its cursor. */
  private async confirmOverlay(): Promise<void> {
    const overlay = this.store.get().overlay
    if (overlay.kind === 'model') {
      const choice: ModelChoice | undefined = overlay.choices[overlay.cursor]
      if (choice === undefined) return
      // Resolve the exact model's reasoning levels; a model that offers some
      // gets a second effort stage before the selection applies (the web
      // picker's two-level menu), one without applies immediately.
      const llm = this.ctx.get('llm')
      const info = llm === undefined ? undefined : await llm.resolveModelInfo(choice.provider, choice.model).catch(() => undefined)
      const efforts = info?.reasoning?.efforts ?? []
      if (efforts.length === 0) {
        this.store.set({ overlay: { kind: 'none' } })
        this.applySelection({ provider: choice.provider, model: choice.model })
        return
      }
      const current = this.selection.current
      const cursor = Math.max(0, efforts.findIndex(effort =>
        current?.reasoningEffort !== undefined && effort.id === current.reasoningEffort))
      this.store.set({
        overlay: {
          kind: 'effort',
          pending: { provider: choice.provider, model: choice.model },
          choices: efforts.map(effort => ({ id: effort.id, label: effort.name ?? effort.id })),
          cursor,
        },
      })
      return
    }
    if (overlay.kind === 'effort') {
      const choice = overlay.choices[overlay.cursor]
      this.store.set({ overlay: { kind: 'none' } })
      if (choice === undefined) return
      this.applySelection({ ...overlay.pending, reasoningEffort: choice.id })
      return
    }
    if (overlay.kind === 'sessions') {
      const row: SessionRow | undefined = overlay.rows[overlay.cursor]
      this.store.set({ overlay: { kind: 'none' } })
      if (row === undefined) return
      await this.reboot(row.id)
    }
  }

  /** Install one selection and publish its label. */
  private applySelection(selection: { provider: string; model: string; reasoningEffort?: ReasoningEffortId }): void {
    this.selection.current = selection.reasoningEffort === undefined
      ? { provider: selection.provider, model: selection.model }
      : { provider: selection.provider, model: selection.model, reasoningEffort: selection.reasoningEffort }
    const effortLabel = this.selection.current.reasoningEffort === undefined ? '' : ` · ${String(this.selection.current.reasoningEffort)}`
    this.store.set({
      modelLabel: `${selection.provider} / ${selection.model}${effortLabel}`,
      notice: `已切换到 ${selection.provider} / ${selection.model}${effortLabel}（下个回合生效）`,
    })
  }

  /** Unmount the surface, persist, and request exit. */
  private async exit(): Promise<void> {
    this.disposed = true
    const handle = this.handle
    this.handle = undefined
    if (handle !== undefined) {
      await this.ctx.sessions.flush(handle.agent.session).catch(() => { /* persistence failures already log at their owner */ })
      await handle.dispose().catch(() => { /* exiting regardless; the launcher drains the tree */ })
    }
    this.exitRequest(0)
  }

  /** `provider / model` label for the status bar. */
  private modelLabel(): string {
    const current = this.selection.current
    return current === undefined ? '' : `${current.provider} / ${current.model}`
  }
}
