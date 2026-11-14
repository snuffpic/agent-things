# 参与贡献

欢迎用中文或英文提交问题与 PR。请附上可复现的步骤，以及 macOS、Node.js、Agent Things 和对应客户端（ChatGPT / Antigravity / Claude Desktop）的版本。提交前删除账号信息、本机路径、会话内容和窗口链接。安全问题请按 [SECURITY.md](SECURITY.md) 私下报告。

## 开发环境

需要 macOS、Node.js 22+ 和 Xcode Command Line Tools（仅在修改 `native/session-status-bridge.swift` 时用于重新编译启动桥）。

```bash
npm ci --ignore-scripts
npm run verify
```

`verify` 依次执行语法检查、启动桥与界面打包构建、生成产物一致性检查、全部自动测试、隔离浏览器回归和 npm 打包检查。打包检查会解开实际的 tarball，核对文件清单、启动桥签名与架构，并在独立 HOME 中走一遍安装与卸载。

## 约定

- 测试使用临时目录和模拟服务，不注册真实 LaunchAgent，也不重启任何客户端。涉及真实客户端的验收在本机单独进行，不进入仓库。
- 修改启动交接、本机端口校验、账本写入或迁移逻辑时，保留并补充对应的回归测试；测试应能在修复前失败。
- 修改 `native/session-status-bridge.swift` 后运行 `npm run build:bridge`，同时提交更新后的 `native/bin/bridge` 与 `native/bin/bridge.json`。
- 不提交凭据、账本、日志、备份文件（`*.bak*`）和本地验收产物。
- 分发副本须保留 LICENSE 与 NOTICE。

PR 请说明触发问题、修改后的行为和验证方式。新增客户端或改变启动方式请先开 issue 讨论。
