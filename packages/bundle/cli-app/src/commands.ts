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

/** Every command the terminal surface owns locally; host commands join /help at runtime. */
export const COMMANDS: readonly CommandDoc[] = [
  { name: 'help', args: '', description: '列出可用命令（含全部宿主命令）' },
  { name: 'model', args: '', description: '选择供应商和模型，含推理强度（弹列表）' },
  { name: 'new', args: '', description: '开始一个全新会话' },
  { name: 'sessions', args: '', description: '列出持久化会话（可选中恢复）' },
  { name: 'resume', args: '<sessionId>', description: '恢复指定会话' },
  { name: 'export', args: '[file]', description: '导出当前会话原始日志为 JSONL 文件' },
  { name: 'interrupt', args: '', description: '中断当前回合（等同 Ctrl+C）' },
  { name: 'exit', args: '', description: '保存并退出' },
]

/** Render the /help listing: local commands plus host-registry descriptors. */
export function helpText(host: readonly { name: string; description: string }[] = []): string[] {
  const rows = [
    ...COMMANDS.map(command => ({ name: command.name, args: command.args, description: command.description })),
    ...host
      .filter(command => !COMMANDS.some(local => local.name === command.name))
      .map(command => ({ name: command.name, args: '', description: command.description })),
  ]
  const width = Math.max(...rows.map(row => row.name.length + row.args.length + 1))
  return rows.map((row) => {
    const spelling = `${row.name} ${row.args}`.trimEnd()
    return `/${spelling.padEnd(width)}  ${row.description}`
  })
}
