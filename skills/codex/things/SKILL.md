---
name: things
description: 在 Codex 信息流唤起 Agent Things 会话任务进度卡片，也可查询、建立、更新或清除会话任务进度清单。当用户选择 $things 或输入 /things 时使用。
---

# Agent Things (`/things`)

用户选择 `$things`、输入 `/things` 或要求打开卡片时，调用 Agent Things 的 `session_status` MCP 工具 `open_session_card`。使用宿主提供的当前真实会话 ID，缺失时通过终端读取 `CODEX_THREAD_ID`，作为 `conversation_id`。标题已知时传 `title`。工具尚未加载时，以 `Agent Things session progress card mcp__session_status__open_session_card` 搜索并调用。工具成功后简短回复「已打开会话进度卡片」。打开卡片只读取已有记录，写入和分析由用户在卡片中触发。

用户明确要求查询、建立、更新、清除进度清单或检查会话能否归档时，按 [Agent Things 进度清单操作说明](checklist.md) 执行对应的 `session_status` MCP 流程。
