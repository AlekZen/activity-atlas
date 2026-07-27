# Changelog

本项目的所有重要变更都会记录在此文件中。
格式基于 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循[语义化版本](https://semver.org/lang/zh-CN/)。

## [0.3.0] - 2026-07-27

### 新增

- 首跑自动安装 AI 协议块：首次启用插件即把协议块写入 AGENTS.md / CLAUDE.md / GEMINI.md，开箱即用（`autoInstallProtocol` 设置可关闭，关闭后退回 Notice 引导）
- `extras/vault-feed-hook.mjs`：可选的 agent SessionStart hook 脚本，会话启动时自动注入未读变更并推进游标（Kimi Code / Claude Code，README 附配置示例）

## [0.2.0] - 2026-07-27

### 新增

- 读取侧按文件合并未读事件（`getChanges` 默认开启，可用 `merge: false` 关闭）
- 一键安装/移除 AI 读取协议块（AGENTS.md / CLAUDE.md / GEMINI.md 标记块，幂等，随插件版本自动刷新）

### 修复

- merge 重命名盲源：`rename A→B` 后删除 B 合并为 `delete A`（读者可理解的旧名）；delete 与 rename 交织且不可无损合并的组拒合并、原样输出
- flush 失败重入队导致日志乱序时，读取侧合并前先按 seq 防御性排序
- 自动同步协议块按文件粒度刷新：只更新已安装块的文件，不再为未安装的目标创建新文件
- 协议块移除兼容 CRLF 换行，不再残留多余空行
- rename 至排除路径时不再把基线条目带过去，消除下次对账的幽灵 delete
- 协议块安装/移除命令 IO 失败时提示并记录 console，不再静默 unhandled rejection

## [0.1.0] - 2026-07-26

### 新增

- 运行期监听 vault 增/删/改/重命名事件，行级 diff 统计增删行数
- 启动时基线对账，补记 Obsidian 关闭期间的变更（含 iCloud/手机端/CLI 来源）；同哈希删建自动识别为 rename
- 机器可读事件流 `changelog.jsonl` + 按读者游标 `cursors.json` + 基线快照 `baseline.gz`
- 读取协议：`getChanges` / `markRead` JS API；外部 agent 可直接读写文件（README 含协议说明）
- 命令 `Copy unread changes for AI`：未读变更摘要复制到剪贴板
- 日志轮转（90 天 / 5 万条可配）与 stale 信号（游标出现空洞时提示全量重扫）
- 基线损坏自动重建并记录 resync 事件；`.obsidian/` 恒排除防自激
- 设置页：跟踪扩展名、排除 glob、大文件阈值、保留策略、基线持久化周期
