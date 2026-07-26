# vault-change-feed

Obsidian 插件：把 vault 变更记录为机器可读事件流（changelog.jsonl）+ 按读者游标（cursors.json），供 AI 增量感知用户变更。

## 规范
- 遵循 `~/Documents/ProgramCode/docs/superpowers/specs/2026-07-10-programcode-project-conventions.md`
- 设计 spec 与实施计划在 workspace 级 `../docs/superpowers/`，不进本仓库
- 核心逻辑在 `src/core/`，为纯函数模块，不得 import 'obsidian'；`src/main.ts` 是唯一 Obsidian 封装层
- 提交前必须 `npm test` 全绿且 `npm run build` 成功；提交格式 `feat/fix/docs/test/chore: <描述>`
- 版本号唯一来源 package.json
