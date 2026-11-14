# Changelog

## 1.2.2 (unreleased)

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
