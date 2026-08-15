/**
 * Slash-command parsing and the command table. Pure: the runner owns
 * execution; this module owns the grammar.
 * @module @deepseek-ai/dsh-cli-app/commands
 */

/** One parsed command line: `/name rest…`. */
export interface ParsedCommand {
  name: string
  args: string
}

/**
 * Parse one submitted line into a command, if it is one.
 * @param line - the raw submitted text.
 * @returns the command, or undefined when the line is an ordinary prompt.
 */
export function parseCommand(line: string): ParsedCommand | undefined {
  if (!line.startsWith('/')) return undefined
  const withoutSlash = line.slice(1).trim()
  if (withoutSlash === '') return undefined
  const space = withoutSlash.indexOf(' ')
  if (space === -1) return { name: withoutSlash, args: '' }
  return { name: withoutSlash.slice(0, space), args: withoutSlash.slice(space + 1).trim() }
}

/** One row of the command table /help prints. */
export interface CommandDoc {
  name: string
  args: string
  description: string
}

/** Every command the terminal surface understands. */
export const COMMANDS: readonly CommandDoc[] = [
  { name: 'help', args: '', description: '列出可用命令' },
  { name: 'model', args: '', description: '选择供应商和模型（弹列表）' },
  { name: 'new', args: '', description: '开始一个全新会话' },
  { name: 'sessions', args: '', description: '列出持久化会话（可选中恢复）' },
  { name: 'resume', args: '<sessionId>', description: '恢复指定会话' },
  { name: 'interrupt', args: '', description: '中断当前回合（等同 Ctrl+C）' },
  { name: 'exit', args: '', description: '保存并退出' },
]

/** Render the /help listing as plain text rows. */
export function helpText(): string[] {
  const width = Math.max(...COMMANDS.map(command => command.name.length + command.args.length + 1))
  return COMMANDS.map((command) => {
    const spelling = `${command.name} ${command.args}`.trimEnd()
    return `/${spelling.padEnd(width)}  ${command.description}`
  })
}
