---
name: things
description: Open the Agent Things session progress card in Codex, or query, create, update, or clear the session Progress Checklist when the user selects $things or types /things.
---

# Agent Things (`/things`)

When the user selects `$things`, types `/things`, or asks to open the card, call `open_session_card` on the Agent Things `session_status` MCP. Pass the real current session ID from host context (or read `CODEX_THREAD_ID` via shell if unavailable) as `conversation_id`, and include `title` when known. If the tool is not yet loaded, search for `Agent Things session progress card mcp__session_status__open_session_card` and invoke it. Once it succeeds, reply concisely: "Opened the session progress card." Opening the card only reads existing records; writes and analysis are triggered by the user inside the card.

When the user explicitly asks to query, create, update, or clear the Progress Checklist, or check whether the session is ready to archive, follow the [Agent Things Progress Checklist Guide](checklist.md) using the `session_status` MCP workflow.
