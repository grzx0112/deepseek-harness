# @deepseek-ai/dsh-cli-app

English | [中文](README.zh.md)

The dsh interactive terminal bundle. [`cordis.patch.yml`](cordis.patch.yml) rides directly over [`dsh-base`](../base/README.md) and mounts this package's `cli-runner` plus its `cli-startup` provider: a single-session Ink terminal UI with no Host, HTTP server, Web runtime, or browser plugin. The base layer's agent-plane rows stay enabled — the TUI is single-session and composes its agent process-wide, which is exactly why `dsh-base` keeps them.

The runner keeps one Agent alive through `ctx.agents`, projects its durable session events into an observable store (`user/message`, `assistant/message`, `tool/call`, `tool/result` become transcript rows; `assistant/chunk` text deltas become the live streaming tail; `turn/start`/`turn/end` drive the running indicator), and routes composer input back through `agent.followup()`. Finalized rows render through Ink `<Static>` into the terminal's native scrollback; only the tail, notice, overlay, and composer repaint.

## Commands

| Command | Effect |
|---|---|
| `/help` | list commands |
| `/model` | overlay every `ctx.llm.listProviders()` × `listModels()` route; selection rewrites the agent's `ModelSelectionRef` and applies at the next step |
| `/new` | dispose the agent and start a fresh session |
| `/sessions` | overlay persisted sessions (`ctx.sessionPersistence.list()`, newest first) |
| `/resume <id>` | resume one persisted session (`ctx.agents.resume`); a failed resume surfaces the error and boots fresh |
| `/interrupt` | cancel the running turn, keeping queued inbox work (also Ctrl+C) |
| `/exit` | flush, dispose, and exit (also double Ctrl+C) |

`dsh --profile cli [sessionId]` boots fresh or resumes the named persisted session. Enter submits a prompt; Ctrl+J inserts a newline; Up/Down walk input history on a single-line draft.

## Model Experience

None beyond the agent's own requests: the runner submits prompts as ordinary user messages and adds no prompt prose.

#### KV Cache effect

None from this package; the agent's requests own the prefix.

## Known Limitations and Deferred Work

- **No approval interaction yet** — a session blocked on a tool approval shows as running; the approval surface (y/n in-terminal) is deferred until the `dsh-interaction` seam is wired in.
- **`/help` rows render as transcript items** — a dedicated static footer is deferred with the overlay generalization.
- **No reasoning-delta tail** — reasoning renders only via the finalized `assistant/message` blocks; a dimmed live reasoning tail is deferred.
