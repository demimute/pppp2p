# PPPP2P

PPPP2P 是一个本地优先的照片去重桌面工具，当前实现为 `Electron + React + Flask` 架构，核心能力围绕照片扫描、相似分组、人工复核、移除与撤销展开。

当前版本：`1.0.1`

## 这份 README 的用途

这个项目已经完成过一轮较大规模迭代，但仍有少量发布链路和体验问题留待后续继续优化。为了方便暂停后重新接手，这个入口文档把“项目是什么、现在到哪一步、应该看哪份文档”收拢到一起。

## 文档导航

- `docs/archive-2026-04.md`
  - 项目完整开发档案，包含目标、架构、阶段时间线、关键提交、已完成能力、已知问题、下一步接手建议。
- `docs/user-manual.md`
  - 当前版本用户手册，面向普通使用者，覆盖启动、分析、复核、移除、撤销、常见问题。
- `docs/electron-acceptance-2026-04-20.md`
  - Electron 桌面端验收计划。
- `docs/acceptance-2026-04-19.md`
  - 人物增强阶段的验收记录。
- `docs/identity-v2.md`
  - identity v2 设计说明。
- `docs/local-free-enhancement-v1.md`
  - 本地免费增强方案 v1，主要针对身份判别和姿态细化方向。
- `docs/windows-portable-readme.txt`
  - Windows 绿色版分发说明。

## 当前项目结论

项目主体已经可用，已经形成完整的桌面端主流程：

- 选择目录
- 扫描图片
- 生成重复/相似分组
- 打开组内对比视图
- 手动指定保留项与待移除项
- 执行移除
- 撤销最近一次移除
- 查看历史与统计

同时已经接入一轮基于人物身份/姿态语义的增强链路，并完成了多轮测试与验收文档沉淀。

当前最主要的未闭环问题不在核心功能，而在 Windows 自包含打包链路：近期排查表明，Windows 产物里仍可能缺少 `backend.exe`，导致“包能下载但不可真正独立运行”。这个问题已经在开发档案里单列。

## 仓库结构

- `src/`
  - React 前端。
- `electron/`
  - Electron 主进程与 preload。
- `backend/`
  - Flask 后端与相似度/身份判别引擎。
- `resources/`
  - 桌面图标等打包资源。
- `docs/`
  - 设计、验收、归档、用户手册。
- `scripts/`
  - 进度与任务管理脚本，以及性能分析脚本。
- `ops/`
  - 项目状态与任务流记录。

## 启动与构建

```bash
npm install
npm run dev
```

常用命令：

```bash
npm run build
npm run build:electron
npm run build:electron:win
npm run test:e2e
```

## 后续接手建议

如果后续继续优化，建议先按这个顺序接手：

1. 先看 `docs/archive-2026-04.md` 了解项目历史和当前风险。
2. 再看 `docs/user-manual.md`，确认当前对用户承诺的行为。
3. 如果要继续处理 Windows 发布，直接从开发档案中的“未完成事项 / 下一步建议”开始。
4. 如果要继续优化人物增强，再看 `docs/local-free-enhancement-v1.md` 与 `docs/identity-v2.md`。
