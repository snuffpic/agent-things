# Changelog

## 1.3.4 (2026-11-20)

- **DeepSeek Harness (`dsh`) full integration**: Added native support for DeepSeek Harness (`dsh --profile web`) via the bundled Cordis package `packages/dsh-agent-things` (`agent-things-dsh`) and standalone stdio MCP server (`bin/dsh-mcp.cjs`), bringing left-sidebar progress rings, the `things` right-pane detail view, `/things` inline command cards, incremental AI task extraction, and local ledger persistence (`~/Library/Application Support/AgentThings/deepseek/manual-state.json`).
- **Task analysis model & reasoning selector in Plugin Manager**: Added the `plugins.bundle.config` slot (`ThingsAnalysisSettings`) using `@deepseek-ai/dsh-client-ui-primitives` (`MenuSurface`, `MenuGroup`, `SegmentedControl`, `Button`, `Tag`, `Input`) so users can pick any DeepSeek account, official API, or custom/third-party `dsh` model and reasoning level (`Off / Low / High / Max`, defaulting to `DeepSeek-V4.1-Flash · Low`), with automatic temporary fallback when a saved custom model becomes unavailable and responsive Refresh button sizing across narrow/mobile widths.
- **CLI, `doctor`, and upgrade parity**: Updated `agent-things` environment probing, `doctor` diagnostics, interactive wizard, `--help`, and `npm-updates` verification to check `dsh` Node `>= 24.9` compatibility, profile `link:` integrity, live bridge/ledger/model routing status, and bundle health.

---

- **新增 DeepSeek Harness（`dsh`）完整接入**：通过内置 Cordis 插件包 `packages/dsh-agent-things`（`agent-things-dsh`）与独立 MCP 入口 `bin/dsh-mcp.cjs`，为 `dsh --profile web` 带来会话列表进度圆环、右侧 `things` 任务面板、`/things` 对话内嵌卡片、增量 AI 任务整理与本地账本持久化（`~/Library/Application Support/AgentThings/deepseek/manual-state.json`）。
- **插件详情页「任务解析模型」与思考程度配置**：接入官方 `plugins.bundle.config` 配置槽位与 `@deepseek-ai/dsh-client-ui-primitives` 原生组件（`MenuSurface`、`SegmentedControl`、`Tag`、`Button` 等），支持读取当前全部可用模型（含 DeepSeek 账号、官方 API 与 `dsh` 自定义 API 模型），默认优选 `DeepSeek-V4.1-Flash · Low`；当原选自定义模型不可用时支持在设置页警示并临时回退到默认可用模型，且头部刷新按钮支持随容器宽度自动切换「刷新模型 / 刷新 / 仅图标」。
- **终端 CLI 与 `doctor` 检查对齐四端**：补全 `agent-things` 探针、`doctor` 诊断、交互向导、`--help` 与自升级校验对 DeepSeek Harness 的支持，涵盖 Node `>= 24.9` 兼容性校验、profile 挂载链接完整性检查、Web 桥接健康状态与解析模型路线展示。

## 1.3.3 (2026-11-17)

- **One-click updates & manual checks across every surface**: Added the `.app-update` banner (`Update available` / `Upgrade` / stage progress / retry / MCP reconnect hint) and wired `app-update-info` / `app-update-start` RPC proxying to both Antigravity inline `/things` cards (`src/antigravity-card.cjs`, `antigravity-harness.js`) and the Antigravity Things side panel (`things_board/main.mjs` & `index.html`).
- **Lightweight version footer with instant `Check updates`**: Added a subtle bottom `.version-bar` across the floating status panel, Codex MCP card, Antigravity inline card, Things side panel, and Claude Mod card/pane (`register.js`), powered by a shared `updateBannerState` helper (`ui-foundation.cjs`) that switches seamlessly into the upgrade banner when a newer version is found via `force: true`.
- **1-hour version cache & Claude alignment**: Reduced automatic npm check caching from 24 hours to 1 hour (`CHECK_INTERVAL_MS = 3600000` in `src/npm-updates.cjs`), forwarded `force` through `codex-card.cjs`, `codex-card-bridge.js`, and `claude-service.cjs`, and aligned Claude Mod hourly re-checks plus upgrade completion messages.

---

- **全端补齐「立即升级」与「检查更新」能力**：为 Antigravity 对话内 `/things` 卡片（`src/antigravity-card.cjs`、宿主代理 `antigravity-harness.js`）以及 Antigravity Things 侧边栏面板（`things_board/main.mjs`、`index.html`）完整接入 `app-update-info` / `app-update-start` 链路与底部升级条 UI。
- **底部轻量版本号栏 + 主动检查更新**：基于 `src/ui-foundation.cjs` 抽离的共享状态机 `updateBannerState`，在悬浮状态面板、Codex MCP 卡片、Antigravity 内联卡片、Things 侧边栏与 Claude 会话卡片/扩展面板统一新增极简 `.version-bar`（显示当前版本号 + `检查更新` 按钮）；平时克制不占空间，点击 `检查更新`（传 `force: true` 绕过缓存）若发现新版立即原地无缝切换为 `发现新版本 vX.Y.Z · 立即升级`。
- **缓存周期缩短为 1 小时 & Claude 插件对齐**：将后台自动检查 npm 版本的缓存窗口从 24 小时缩短为 1 小时（`src/npm-updates.cjs`）；补全 Codex MCP 卡片工具（`codex-card.cjs` / `codex-card-bridge.js`）与 Claude `inline` 接口的 `force` 参数透传，并对齐 Claude 插件的长会话周期检查、升级阶段与完成重连提示。

## 1.3.2 (2026-11-17)

- **Task titles displayed clearly across all panels**: Unified the floating status panel (`src/session-status.js`) and the Claude `/things` Mod card to display the full `task.title` before falling back to `task.summary`—matching Antigravity cards and preventing short status remarks from hiding what the task actually is.
- **Cleaner Claude transcript extraction**: Filtered out `isMeta` internal prompt injections, stripped leading Claude Code machine envelopes (`<system-reminder>`, `<task-notification>`, `<side-sessions-event>`, `<local-command-caveat>`, slash-command tags) across multi-part messages without losing user replies, and trimmed compaction resume boilerplate and raw `.jsonl` paths from compact summaries.
- **Tighter analysis prompts & schemas (`v5`)**: Added explicit field descriptions in `output.schema.json` and `output.en.schema.json`, tightened bilingual analysis rules so both `title` and short `summary` must name "action + target" rather than status/deferral notes, and bumped `versions.prompt` / `versions.schema` to `5` so existing sessions cleanly refresh on the next update.
- **Release CI fix**: Fixed `npm publish ./dist/*.tgz` path resolution in `.github/workflows/release.yml` for npm 11+.

---

- **三端统一优先展示完整任务标题**：将悬浮状态面板（`src/session-status.js`）与 Claude `/things` 对话内卡片统一为优先展示 `task.title`（无标题时再回退 `task.summary`），与 Antigravity 保持一致，避免“待定”“未做，待安排”等短批注盖住具体任务名称。
- **净化 Claude 会话清洗结构**：过滤 `isMeta` 内部系统注入消息，按消息分块剥离 Claude Code 前导机器信封（`<system-reminder>`、`<task-notification>`、`<side-sessions-event>`、`<local-command-caveat>` 及内置命令标签）且无损保留用户正文发言，并移除上下文压缩摘要首尾英文恢复套话与本地 `.jsonl` 路径。
- **加固分析提示词与 Schema 约束（`v5`）**：为中英文 Output Schema 补充 `title` 与 `summary` 字段职责说明，收紧提示词规则明确要求两者均须采用“动作 + 对象”短标题、严禁写入纯状态批注，并将规则版本升至 `5`，以便旧会话下次“更新进度”时同步纠正历史偏差。
- **发布工作流修复**：修复 `.github/workflows/release.yml` 在 npm 11+ 下缺少 `./` 前缀导致 `npm publish` 误判文件路径为仓库名的问题。

## 1.3.1 (2026-11-17)

- **Theme accent colors and UI polish**: Progress panels, inline `/things` cards, and the Antigravity side panel now follow each host client's active accent color (ChatGPT `--color-ring-primary`, Antigravity `customThemeSeeds`, and Claude Desktop Code's 32 Appearance themes across light and dark modes) with automatic foreground contrast protection. Refined button, progress slider, tooltip, and panel interaction transitions.
- **No light-mode first-frame flash**: Added pre-paint color-scheme initialization, immediate host theme sync, and fallback light rules across the floating panel, Codex MCP card, Antigravity inline card, and Things side panel (`--at-panel-bg`).
- **Faster `/things` and Antigravity card fixes**: Switched Antigravity `/things` hooks to a single-turn `ephemeralMessage` fast-path with duplicate-invocation guards and eager `render_things_card` registration across both `~/.gemini/antigravity/mcp_config.json` and `~/.gemini/config/mcp_config.json`; inline `/things` cards now auto-resize smoothly to full height, stay isolated when the Things side panel is open, sync manual edits/clears immediately into the inline card without waiting for SSE, and open the side panel without reloading when already mounted.
- **Claude Desktop i18n fix**: Bundled `ui-foundation` presentation data into Claude's host helper with an inline fallback and completed missing dictionary keys so labels switch cleanly between English and Simplified Chinese.

---

- **主题强调色联动与界面打磨**：状态面板、对话内 `/things` 卡片及 Antigravity Things 侧栏现自动跟随宿主客户端当前主题色（ChatGPT `--color-ring-primary`、Antigravity `customThemeSeeds` 与 Claude Desktop Code 的 32 套浅色/深色代码主题），并自动计算高对比度按钮前景色；同步优化按钮、进度滑块、提示浮层及面板交互动效。
- **消除浅色模式首帧闪烁**：为悬浮状态面板、Codex MCP 卡片、Antigravity 内联卡片与 Things 侧栏（修复 `--at-panel-bg` 拼写）加入渲染前配色初始化、同步 `<head>` 主题检测与浅色兜底样式。
- **Antigravity `/things` 提速与卡片/侧栏修复**：为 `/things` 接入单轮 `ephemeralMessage` 快速通道（带 `invocationNum` 防重入保护），并在 `~/.gemini/antigravity/mcp_config.json` 与 `~/.gemini/config/mcp_config.json` 中启用 `render_things_card` 的 `eager` 原生工具配置；修复内联卡片高度被宿主截断在 200px 的问题（自动撑开至完整高度）、修复侧栏与内联卡片共存隔离、修复在卡片内手动保存/清除进度时本地视图与侧边/SSE 同步竞态，并在侧栏已挂载时无重载复用打开。
- **Claude Desktop 双语修复**：在 Claude 宿主注入链中加载 `ui-foundation` 字典并提供内嵌兜底，补全缺失的多语言键名，修复切换中英文时局部文本回退或缺失的问题。

## 1.2.2 (2026-11-15)

- The npm package page now shows the English README; the Chinese README moved to `docs/README.zh-CN.md` and is linked from the top of the English one.
- Analysis tests no longer depend on ChatGPT.app being installed, and the browser check tolerates slower CI machines.

---

- npm 包页面改为显示英文 README；中文 README 移到 `docs/README.zh-CN.md`，英文 README 顶部有链接。
- 分析相关测试不再依赖本机安装 ChatGPT.app，界面浏览器检查适应较慢的 CI 机器。

## 1.2.1 (2026-11-14)

First public release. Agent Things is a session task progress plugin for ChatGPT, Antigravity and Claude Desktop.

- Progress rings in the session list open a status panel with manual records, model-organized tasks, completed and remaining tasks, links back to the source messages, and notes.
- The `npx agent-things` wizard lets you choose clients and installs the plugin runtime, background service, MCP tools and `/things` skills in one go; uninstalling keeps your ledger and backups.
- English and Chinese: the interface, the `/things` card, the skills and the model-written tasks follow the chosen language. The first install suggests the system language; switch with `setup --lang en|zh` or from the management menu, and existing tasks are rewritten in the new language at the next analysis.
- Checks npm for a new version once a day, with one-click updates from the panel and the management menu; updates run as a separate background job and wait for any running analysis to finish.
- ChatGPT startup handoff: the plugin asks the client to quit only once its window is ready, so an early request can't bypass the client's quit lifecycle; the handoff is kept while the client shuts down and the client reopens with the debugging port once it exits; if the client cancels the quit, the request is retried as long as there is no user input.

---

首个公开版本。Agent Things 是会话任务进度插件，支持 ChatGPT、Antigravity 与 Claude Desktop。

- 会话列表显示进度标记，点击打开状态面板：手动记录、模型整理任务、已完成与剩余任务、原文来源定位、备注。
- 通过 `npx agent-things` 向导选择客户端，统一安装插件运行时、后台服务、MCP 工具与 `/things` 技能；卸载保留账本与备份。
- 中英双语：界面、`/things` 卡片、技能和模型整理的任务跟随所选语言；首次安装按系统语言推荐，可用 `setup --lang zh|en` 或管理菜单切换，切换后已有任务在下次分析时改写为新语言。
- 每天检查 npm 新版本，面板与管理菜单可一键升级；升级在独立后台任务中执行，等待进行中的分析结束。
- ChatGPT 启动交接：等待客户端窗口就绪后才请求正常退出，避免启动早期请求绕过客户端退出流程；客户端收尾期间保留交接，退出后自动以调试端口重开；客户端取消退出时在无输入的情况下重试。
