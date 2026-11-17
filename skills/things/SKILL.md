---
name: things
description: 唤起并内嵌渲染 Agent Things 会话任务进度卡片，也可查询、建立、更新或清除会话任务进度清单。当用户输入 /things 或要求展示任务卡片、获取/更新/清除进度时使用。
---

# Agent Things (`/things`)

用户输入 `/things` 或要求查看当前会话卡片时：
- 若当前上下文的 Hook 快速通道已直接提供本次预生成的 `<agent-embed ...>` 与进度摘要 Markdown，无需调用任何文件读取或 MCP 工具，直接原样输出该完整 Markdown 即可；
- 否则直接调用 Agent Things 的 `session-status` MCP 工具 `render_things_card`（若已注册为原生 Eager 工具如 `mcp_session-status_render_things_card` 则直接调用，无需通过 `call_mcp_tool` 跳转或重复读取技能/Schema），参数为 `conversation_id`（当前会话 ID），并将返回的 `user_markdown` 原样输出给用户。打开卡片只读取已有记录，空会话直接显示「尚未记录进展」，写入和分析由用户在卡片中触发。严禁执行任何额外的终端脚本、文件搜索或推演操作。

用户明确要求查询、建立、更新、清除进度清单或检查会话能否归档时，按 [Agent Things 进度清单操作说明](checklist.md) 执行对应的 `session-status` MCP 流程。
