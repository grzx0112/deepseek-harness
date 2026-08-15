# @deepseek-ai/dsh-cli-app

[English](README.md) | 中文

dsh 交互式终端 bundle。[`cordis.patch.yml`](cordis.patch.yml) 直接叠加在 [`dsh-base`](../base/README.md) 之上，挂载本包的 `cli-runner` 与其 `cli-startup` 提供方：单会话 Ink 终端 UI，不含 Host、HTTP 服务、Web 运行时或浏览器插件。base 层的 agent 面各行保持启用——TUI 是单会话、进程级组合 agent 的形态，这正是 `dsh-base` 保留它们的原因。

runner 通过 `ctx.agents` 常驻一个 Agent，把持久会话事件投影到可观察 store（`user/message`、`assistant/message`、`tool/call`、`tool/result` 成为转录行；`assistant/chunk` 文本增量成为实时流式尾部；`turn/start`/`turn/end` 驱动运行指示器），并把输入框内容经 `agent.followup()` 送回。已定稿的行经 Ink `<Static>` 打印进终端原生回滚区；只有尾部、提示、浮层和输入框参与重绘。

## 命令

| 命令 | 作用 |
|---|---|
| `/help` | 列出命令——本地命令与全部宿主注册命令合并展示 |
| `/model` | 浮层列出全部 `ctx.llm.listProviders()` × `listModels()` 路由；所选模型提供推理强度时进入第二级选择（与 web 选择器的两级菜单一致），下个步骤生效 |
| `/new` | 释放当前 agent，开始全新会话 |
| `/sessions` | 浮层列出持久化会话（`ctx.sessionPersistence.list()`，最新在前） |
| `/resume <id>` | 恢复指定持久化会话（`ctx.agents.resume`）；恢复失败会提示错误并改为新建 |
| `/export [file]` | 落盘并把原始持久化日志（JSONL 文本）写到当前目录旁的文件 |
| `/interrupt` | 取消当前回合，保留排队的 inbox 工作（等同 Ctrl+C） |
| `/exit` | 落盘、释放并退出（也可双击 Ctrl+C） |
| 其他任意 `/name …` | 经宿主命令注册表（`ctx.commands.execute`）分发——与 web 输入框同一注册表，因此 `/compact`、`/plan`、`/goal`、`/feedback`、`/permission` 及未来的宿主命令语义完全一致；其 `command/run`/`command/done` 生命周期会渲染进转录 |

`dsh --profile cli [sessionId]` 新建会话启动，或恢复指定持久化会话。Enter 提交输入；Ctrl+J 换行；单行草稿下 Up/Down 翻阅输入历史。

## Model Experience

除 agent 自身的请求外无额外内容：runner 以普通用户消息提交输入，不添加任何提示词。

#### KV Cache effect

本包无影响；请求前缀归属 agent。

## 已知限制与待办

- **审批交互未接** — 被工具审批阻塞的会话显示为运行中；终端内 y/n 审批界面待接入 `dsh-interaction` 接缝后补齐。
- **`/help` 以转录行渲染** — 独立的静态页脚随浮层泛化一并处理。
- **无实时思考尾部** — 思考内容仅经定稿的 `assistant/message` 块渲染；灰色实时思考尾部待补。
