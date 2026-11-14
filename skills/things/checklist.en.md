# Agent Things Progress Checklist Guide

This guide covers querying, creating, updating, and clearing session Progress Checklists via the `session_status` MCP (displayed as `session-status` in Antigravity) when using Agent Things (`/things`). Use it for requests such as "get task progress for this session", "update progress", "where did we leave off", "what tasks remain", "clear progress", or checking if a session is ready to archive.

Reply in the user's current language ("Progress Checklist" in English, "进度清单" in Chinese). Refer to the conversation by its session title or "current session" when speaking to the user.

## Session Identity

- Codex: obtain the real session ID from `CODEX_THREAD_ID` or explicit session context.
- Antigravity: obtain the Conversation ID from session metadata.
- Claude: obtain the real CLI session ID from host-provided session metadata; the service maps it to the corresponding Desktop session record using local metadata. The `/things` command opens the current session card.
- If the user specifies another session, use the specified ID. When identity is missing, locate the host session first, or ask the user to confirm if still ambiguous.
- Use the workspace path corresponding to the current session for `project_path`.

## Getting & Updating Progress

When the user explicitly asks to "get task progress for this session" or similar, your authorization covers reading, initial extraction, saving, and read-back verification.

1. Call `get_session_progress` with the real `conversation_id`.
2. If a record exists, report the saved total tasks, completed count, percentage, remaining tasks, and updated time. If the user asks to update, apply incremental changes on top of the existing ledger and recent conversation turns.
3. If no record exists or `cleared: true` is returned, inspect accessible user requests and final assistant replies in the target session, organize completed and remaining milestones for the full goal, and create the checklist with `update_session_tasks`.
4. After writing, call `get_session_progress` again to confirm the tasks, percentage, and revision before reporting back to the user.

Reuse task details already visible in context first. When longer history is needed, paginate through the host's session-reading capability and keep real user requests, scope changes, cancellations, confirmations, and final replies while filtering raw tool noise, reasoning, and internal machine events.

Follow user and host delegation constraints if delegating analysis. When allowed, prefer a lightweight/economical model and pass the target session ID, existing ledger, and coverage boundary so the worker performs read, write, and read-back verification and returns a concise summary.

If accessible history is incomplete, state the coverage scope explicitly and cite evidence for historical completions. Keep confirmed scope and status in the summary; judge git commits, pushes, and live device verification from concrete evidence.

## MCP Tool Contract

| Tool | Purpose |
| --- | --- |
| `get_session_progress` | Read the exact current record and task ledger by `conversation_id` |
| `update_session_tasks` | Create or incrementally update the task list (percentage is computed by the service) |
| `update_session_progress` | Save an explicit manual percentage and note requested by the user |
| `clear_session_progress` | Clear progress, completed/remaining tasks, notes, and timeline for the session |
| `list_all_session_statuses` | Query sessions by resolved project identity, recent 25, or all projects |

Project queries rely on resolved project ownership stored in records. Always rely on `get_session_progress` to judge whether a specific session already has a record; never reuse records from other sessions in project listings.

Parameter rules for `update_session_tasks`:

- Initial creation: `expected_revision: 0`. If updating an existing record or after `cleared: true`, pass the latest `revision` just read.
- New tasks use `knownTaskId: null`; existing tasks reuse their `id` as `knownTaskId`.
- Store the complete task name in `title` (in natural English when configured for English).
- Set each task's `summary` to a concise action + object label of **at most 60 characters**. Detailed context belongs in `title`, `source`, and session text.
- Set the top-level `summary` in natural English describing the current goal and remaining work.
- Set `status` to one of: `todo`, `in_progress`, `blocked`, `needs_verification`, or `done`.
- Only submit new or changed tasks in `tasks`; the service preserves untouched tasks (including done items).
- List explicitly cancelled, replaced, or dropped task IDs in `removedTaskIds` (usually `[]` initially).
- Attach `source` when available (`locator`: a verbatim continuous 10–240 char snippet from a user prompt or final reply, optionally with `turnId` and `itemId`). The service verifies it so the UI shows "View source". Existing refs can reuse `evidenceRefs`.
- Pass `project_path` when the project path is known.

On `REVISION_CONFLICT`, re-read the ledger, reconcile changes, and retry. If a `summary` exceeds the limit, shorten that task's summary per the error message and retry. On read or service errors, report the exact failure while preserving the last successful result.

Example initial creation:

```json
{
  "conversation_id": "<current session ID>",
  "expected_revision": 0,
  "summary": "Core features implemented; awaiting user UI verification",
  "tasks": [
    {"knownTaskId": null, "title": "Implement session task progress service", "summary": "Implement task progress service", "status": "done"},
    {"knownTaskId": null, "title": "Complete user visual and interaction review", "summary": "Verify UI and interactions", "status": "todo"}
  ],
  "removedTaskIds": []
}
```

## Clearing Progress & Tasks

Run the clear workflow when the user explicitly asks to "clear progress" or "clear session tasks" using the current or specified real `conversation_id`.

1. Call `get_session_progress` to fetch the record and latest `revision`; if none or `cleared: true`, inform the user there is no progress recorded.
2. Call `clear_session_progress` with `conversation_id` and the read `expected_revision`. This clears progress, completed and remaining tasks, notes, task sources, and timeline records.
3. Verify the response returns `cleared: true`, `tasks: []`, `progress: null`, read back via `get_session_progress`, and concisely confirm cleared. Any subsequent rebuild uses the `revision` returned by the clear call as `expected_revision`.

```json
{
  "conversation_id": "<target session ID>",
  "expected_revision": 158
}
```

On `REVISION_CONFLICT`, re-read the record and confirm the target before retrying. If tools are not yet visible, instruct the user to reconnect the Agent Things (`session_status` / `session-status`) MCP and retry. After clearing, keep the record empty; rebuild the checklist only when the user asks for it.

## Reporting Results

After writing and reading back successfully, report concisely: "Updated to X%, A/B completed, C remaining", listing key remaining tasks and any coverage/verification notes. Judge archiving readiness from remaining tasks, delivery state, and user instructions. When a major milestone is reached, submit the confirmed task changes to the existing checklist and tell the user the latest result.
