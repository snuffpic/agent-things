---
name: things
description: Open and embed the Agent Things session progress card, or get, create, update, or clear the session Progress Checklist when the user invokes /things or asks about task progress.
---

# Agent Things (`/things`)

When the user runs `/things` or asks to view the current session card, immediately call the `render_things_card` tool on the Agent Things `session-status` MCP with `conversation_id` set to the current session ID. Once it succeeds, output the returned `user_markdown` verbatim to the user. Opening the card only reads existing records; an empty session displays "No progress recorded yet", and writes/analysis are triggered by the user inside the card. Never run extra shell scripts, file searches, or ad-hoc deductions when opening the card.

When the user explicitly asks to query, create, update, or clear the Progress Checklist, or check whether the session is ready to archive, follow the [Agent Things Progress Checklist Guide](checklist.md) using the `session-status` MCP workflow.
