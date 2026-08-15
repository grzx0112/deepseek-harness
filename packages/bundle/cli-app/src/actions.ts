/**
 * The UI→runner action contract: everything the Ink surface can ask the
 * driver to do. The app never touches Cordis services directly.
 * @module @deepseek-ai/dsh-cli-app/actions
 */

/** Methods the terminal surface calls on the runner. */
export interface TuiActions {
  /** Submit one human prompt to the live agent. */
  prompt(text: string): void
  /** Dispatch one leading-slash command line (`/model`, `/exit`, …). */
  command(line: string): void
  /** Interrupt the running turn, keeping queued inbox work. */
  interrupt(): void
  /** Tear down the surface and agent, then request process exit. */
  exit(): Promise<void>
  /** Close the open overlay without acting. */
  cancelOverlay(): void
  /** Move the open overlay cursor by `delta`, clamped to `[0, size)`. */
  moveOverlay(delta: number, size: number): void
  /** Append one typed character to the open overlay's filter query. */
  overlayType(ch: string): void
  /** Delete the last character of the open overlay's filter query. */
  overlayBackspace(): void
  /** Act on the overlay row under its cursor. */
  confirmOverlay(): void
}
