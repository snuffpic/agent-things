---
name: agent-things
description: Agent Things 会话任务进度清单核心技能。当用户通过 /things 卡片、或直接要求获取任务进度、更新进度、查看上次进度、查询遗留任务、清除进度及检查会话是否可归档时，通过 session_status MCP（Antigravity 下为 session-status）完成读写操作。
user-invocable: false
---

# Agent Things 会话进度清单

使用用户当前的语言回复，中文称“进度清单”，英文称“Progress Checklist”。面向用户使用会话标题或“当前会话”。

## 当前会话身份

- Codex 从 `CODEX_THREAD_ID` 或明确的会话上下文获取真实会话 ID。
- Antigravity 从会话元数据获取 Conversation ID。
- Claude 从宿主提供的会话元数据获取真实 CLI 会话 ID，服务会依据本机元数据映射到对应的 Desktop 会话记录。界面的 `/things` 命令可打开当前会话卡片。
- 用户指定其他会话时使用指定 ID。身份缺失时先定位宿主会话，仍无法确定时向用户确认目标。
- 工程路径使用当前会话对应的工作区路径。

## 获取进度

用户说“获取该会话的任务进度”等明确请求时，授权范围包含查询、首次整理、保存和回读确认。

1. 调用 `get_session_progress`，传入真实 `conversation_id`。
2. 有记录时，报告已保存的任务数、完成数、比例、剩余任务及更新时间。用户要求更新时，结合原账本和后续对话提交变化。
3. 暂无记录或返回 `cleared: true` 时，读取目标会话中可访问的用户要求与模型最终答复，整理完整目标中的已完成及剩余里程碑，通过 `update_session_tasks` 首次创建。
4. 写入后再次调用 `get_session_progress`，确认任务、百分比和版本，再向用户报告结果。

已有上下文能提供的任务信息优先复用。需要读取较长历史时，使用宿主的会话读取能力按需分页，保留真实用户要求、变更、取消、确认以及最终答复。工具原始输出、思考过程和后台机器事件在本地清洗时过滤。

委派执行遵循用户和宿主的授权约束。允许委派时优先使用可用的经济型模型，传递目标会话 ID、已有账本与覆盖边界，由执行者完成读取、写入和回读，并返回简短结论。

可访问历史不足时明确说明覆盖范围；历史报告的完成项注明依据。任务摘要保存已确认的范围和状态。Git 提交、推送及当前实机验收分别依据对应证据判断。

## MCP 调用契约

| 工具 | 用途 |
| --- | --- |
| `get_session_progress` | 按会话 ID 精确读取当前记录和任务账本 |
| `update_session_tasks` | 首次创建任务清单或提交任务增量，由程序计算任务完成比例 |
| `update_session_progress` | 保存用户明确指定的人工百分比与备注 |
| `clear_session_progress` | 清除指定会话的进度、全部已完成及剩余任务、备注与进展记录 |
| `list_all_session_statuses` | 查询工程、最近25条或全局会话记录 |

工程查询依赖记录中的工程归属。判断某个会话是否已有记录时，以 `get_session_progress` 的精确查询结果为准。

精确查询返回暂无记录时，按首次整理流程创建当前会话的清单。工程列表中的其他会话保留各自身份，不能用作当前会话的任务记录。

`update_session_tasks` 的参数规则如下。

- 首次创建使用 `expected_revision: 0`。已有记录或返回 `cleared: true` 时使用刚刚读到的 `revision`。
- 新任务使用 `knownTaskId: null`；已有任务使用其 `id` 作为 `knownTaskId`。
- `title` 保存完整任务名称。
- 每项任务的 `summary` 概括动作和对象，最多20个字符，中文、英文、数字和标点均计数。详细证据使用完整标题、来源及会话内容承载。
- 顶层 `summary` 表达当前目标和剩余事项，与任务短总结分别填写。
- `status` 使用 `todo`、`in_progress`、`blocked`、`needs_verification` 或 `done`。
- `tasks` 提交新增和发生变化的任务，服务继承其余任务，包括已完成项。
- `removedTaskIds` 记录明确取消、替代或移出目标的任务，首次创建通常为 `[]`。
- 每项任务附 `source`，其中 `locator` 使用原始用户提问或最终答复中10至240个字符的连续原文；可附 `turnId` 和 `itemId` 消除重复引用。服务核对原文后关联消息位置，面板显示“查看来源”。已有短事件引用可通过 `evidenceRefs` 复用。
- 项目已知时传入 `project_path`。

版本冲突时重新读取最新账本，再核对变化。摘要超长时依据错误中的任务位置缩短该项，再重试。出现读取或服务错误时报告具体故障，保留上一次成功结果作为历史记录。

首次创建示例。

```json
{
  "conversation_id": "<当前会话 ID>",
  "expected_revision": 0,
  "summary": "功能实现完成，剩余用户验收",
  "tasks": [
    {"knownTaskId": null, "title": "实现会话任务状态功能", "summary": "实现任务状态功能", "status": "done"},
    {"knownTaskId": null, "title": "完成用户视觉与交互验收", "summary": "验收视觉与交互", "status": "todo"}
  ],
  "removedTaskIds": []
}
```

## 清除进度与任务

用户明确要求“清除进度”“清空该会话任务记录”时执行清除流程。目标使用当前或用户指定的真实会话 ID。

1. 调用 `get_session_progress` 获取目标记录与最新 `revision`；暂无记录或返回 `cleared: true` 时直接说明当前没有进度记录。
2. 调用 `clear_session_progress`，参数为 `conversation_id` 和刚读取的 `expected_revision`。该操作立即清除进度、全部已完成和剩余任务、备注、任务来源及进展记录。
3. 检查返回 `cleared: true`、`tasks: []`、`progress: null`，再通过 `get_session_progress` 确认返回 `cleared: true` 且任务为空，简短报告已清除。后续重新建立记录使用清除返回的 `revision` 作为 `expected_revision`。

```json
{
  "conversation_id": "<目标会话 ID>",
  "expected_revision": 158
}
```

版本冲突时重新读取并核对目标后再提交。工具尚未出现在可用列表时，提示重新连接 Agent Things（`session_status`）MCP 后重试。清除流程完成后保持空记录，后续按用户请求重新整理任务。

## 结果播报

写入和回读成功后，简短报告“已更新为 X%，完成 A/B 项，剩余 C 项”，列出关键遗留任务。按需注明历史覆盖范围及核验依据。

归档判断同时考虑剩余任务、交付状态和用户要求。重大里程碑出现时，将已确认的任务变化提交到现有清单，并告知最新结果。
