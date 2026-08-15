/**
 * The interactive terminal app's command-line provider: it parses the optional
 * resume positional and `--help`, then publishes {@link CLI_STARTUP_SERVICE}.
 * The runner is an ordinary consumer whose lazy config waits for that service.
 * @module @deepseek-ai/dsh-cli-app/startup
 */

import { Command } from 'commander'
import type { Context } from '@deepseek-ai/cordis'
import { parseCmdline } from '@deepseek-ai/dsh-cmdline'

/** Stable Cordis plugin name. */
export const name = 'cli-startup'

/** Services required before the startup values can be resolved. */
export const inject = ['cmdlineArgs']

/** Service provided by this plugin and injected by the interactive runner. */
export const CLI_STARTUP_SERVICE = 'cliStartup'

/** What the runner row reads from {@link CLI_STARTUP_SERVICE}. */
export interface CliStartupValues {
  /** Persisted session id to resume, or undefined for a fresh session. */
  resumeSessionId: string | undefined
}

/**
 * This app's command: the optional resume positional, its description, and
 * its help text.
 * @returns a fresh program, so one process can parse more than once (tests).
 */
function cliCommand(): Command {
  return new Command()
    .name('dsh --profile cli')
    .description('Interactive terminal chat over the harness.')
    .helpOption('-h, --help', 'show this help')
    .argument('[sessionId]', 'persisted session id to resume; omit for a fresh session')
    .addHelpText('after', `
Examples:
  dsh --profile cli                 interactive chat, fresh session
  dsh --profile cli session-abc123  resume one persisted session by id
`)
}

/**
 * Parse and provide the interactive startup values as an ordinary Cordis
 * service. The command's action publishes the values; on rejection (and on
 * `--help`) nothing is provided.
 * @param ctx - plugin context carrying the command line.
 */
export function apply(ctx: Context): void {
  const program = cliCommand()
  program.action(() => {
    const sessionId = program.args[0]
    ctx.provide(CLI_STARTUP_SERVICE, {
      resumeSessionId: sessionId === undefined || sessionId.trim() === '' ? undefined : sessionId.trim(),
    } satisfies CliStartupValues)
  })
  parseCmdline(ctx, program)
}
