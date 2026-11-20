# Agent Things for DeepSeek Harness (`agent-things-dsh`)

Things-style session progress rings, workspace notes, `/things` commands, and source-linked AI task extraction for DeepSeek Harness.

## Features

- **Session progress rings & notes**: Track session progress (`25%`, `50%`, `75%`, `90%`, `100%` / `unfinished`, `waiting`, `completed`) directly in the conversation list and header.
- **`/things` slash command & inline card**: Render interactive progress checklists inside conversations.
- **Source-linked AI to-do extraction**: Extract structured tasks from replies and jump back to the exact source message.
- **Task analysis model settings**: Choose the extraction model (default `DeepSeek-V4.1-Flash`, including custom OpenAI API models configured in DSH) and reasoning effort (`Off`, `Low`, `High`, `Max`).

## Repository & Installation

Maintained in [snuffpic/agent-things](https://github.com/snuffpic/agent-things) (`packages/dsh-agent-things`). Install or manage across ChatGPT, Antigravity, Claude Desktop, and DeepSeek Harness via `npx agent-things`.
