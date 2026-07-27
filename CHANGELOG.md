# Changelog

本项目的所有重要变更都会记录在此文件中。
格式基于 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循[语义化版本](https://semver.org/lang/zh-CN/)。

## [1.1.0] - 2026-07-27

### 新增

- 移动端支持：文件操作从 Node `fs` 迁移到 `vault.adapter`（官方 API），`isDesktopOnly` 移除

### 修复

- 消除社区目录「Direct Filesystem Access」警告：插件不再直接访问文件系统

## [1.0.1] - 2026-07-27

### 修复

- 社区目录自动审查反馈：`builtin-modules` 换为 Node 内置 `node:module`（减一个依赖）；`cursors.ts` JSON 解析类型收窄；`onunload` 返回值类型对齐 Plugin 接口；设置文案移除 `.obsidian` 字面量（逻辑本就用 `vault.configDir`）

## [1.0.0] - 2026-07-27

首个公开发布版本。

### 新增

- 运行期监听 vault 增/删/改/重命名事件，行级 diff 统计增删行数
- 启动时基线对账，补记 Obsidian 关闭期间的变更（含 iCloud/手机端/CLI 来源）；同哈希删建自动识别为 rename
- 机器可读事件流 `changelog.jsonl` + 按读者游标 `cursors.json` + 基线快照 `baseline.gz`
- 读取协议：`getChanges` / `markRead` JS API；外部 agent 可直接读写文件（README 含协议说明）
- 读取侧按文件合并未读事件（`getChanges` 默认开启，`merge: false` 关闭）；不可无损合并的组原样透传
- 日志轮转（90 天 / 5 万条可配）与 stale 信号（游标出现空洞时提示全量重扫）
- 基线损坏自动重建并记录 resync 事件；`.obsidian/` 恒排除防自激
- 开箱即用的 AI 发现机制：首跑自动把读取协议块写入 AGENTS.md / CLAUDE.md / GEMINI.md（标记块、幂等、随版本自动刷新、可关闭），附 install/remove 命令
- 命令 `Copy unread changes for AI`：未读变更摘要复制到剪贴板
- `extras/vault-feed-hook.mjs`：可选的 agent SessionStart hook 脚本，会话启动自动注入未读变更并推进游标（Kimi Code / Claude Code）
- 设置页：跟踪扩展名、排除 glob、大文件阈值、保留策略、基线持久化周期、协议块安装/同步开关
