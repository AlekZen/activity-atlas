# Changelog

本项目的所有重要变更都会记录在此文件中。
格式基于 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循[语义化版本](https://semver.org/lang/zh-CN/)。

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
