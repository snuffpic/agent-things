## Overview

Agent Things brings Things-style session progress management and structured to-do extraction to DeepSeek Harness without changing your active chat model.

## Key Capabilities

- **Session status & progress rings**: Set `unfinished`, `waiting`, or `completed` states and fine-grained percentage rings from the sidebar or conversation header.
- **Right workspace & `/things` cards**: View all extracted to-dos, manually added tasks, and session notes; click any source-linked item to jump directly to the originating message.
- **`/things` slash command & MCP sync**: Read or update task lists from prompts via `/things` or the bundled MCP tools, backed by `~/.codex/session-status/manual-state.json`.
- **Independent analysis model & reasoning effort**: Configure the model used for background task extraction (defaults to `DeepSeek-V4.1-Flash` with `Low` reasoning effort, and supports custom API models added in DSH) from this plugin settings page.
