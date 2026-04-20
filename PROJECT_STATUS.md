# PROJECT_STATUS

## 当前阶段
阶段 3：identity v2 收口完成，转入 Electron/真实目录联合复验

## 当前唯一目标
在浏览器态主线稳定、identity v2 已建立固定难例基准集并收口的前提下，完成 Electron/桌面端与真实目录的联合验收。

## 当前状态摘要
- `SPEC.md` 已完成并提交。
- 浏览器态主线闭环已打通，compare/remove/undo 主流程可用。
- identity v2 已完成：24 维本地轻量向量、头区肤色信号、torso 2x2 分块亮度、版本化 persona cache（`persona_v2`）。
- 固定难例基准集已建立：`tests/fixtures/build_identity_v2_baseline.py`。
- 四条核心 Playwright 回归已通过：
  - `tests/e2e/workflow.spec.js`
  - `tests/e2e/compare-shortcuts.spec.js`
  - `tests/e2e/multi-group-history.spec.js`
  - `tests/e2e/repeated-undo.spec.js`
- 已收敛的关键问题包括：
  - Winner 仍可被标记移除
  - ComparePanel 快捷键焦点与真实交互不一致
  - 多组撤销断言依赖脆弱瞬时文案
  - 重复撤销复用脏目录导致假失败
  - rebuilt folder 继承 stale backend undo/history 状态
  - 并行 worker 共享 `/tmp` 夹具目录导致 repeated-undo 串扰
- 当前主阻塞已从“主链路是否能跑通”切换为“Electron/桌面态是否与浏览器态结果一致”。

## 已完成模块
- 项目目录初始化
- Git 仓库初始化
- SPEC 文档
- 后端基础 API 与智能模块
- 前端基础组件骨架
- 端口/策略名/预计算逻辑修正
- 浏览器态 compare/remove/undo 主线联调
- 核心 Playwright E2E 基础设施与四条主链路回归
- 撤销/历史/多组/快捷键/重复操作稳定性修复

## 当前阻塞项摘要
1. Electron 桌面态尚未完成一轮与当前 web E2E 同级别的可见复验。
2. identity v2 虽已在固定难例集上收口，但仍缺真实目录规模化观察与阈值复盘。
3. 打包产物虽然已有构建结果，但还缺一轮基于真实交互的桌面端冒烟确认。

## 最近一次验证结果
- 验证项：identity v2 + 后端 persona 回归 + 人物增强 Playwright
- 命令：`python3.11 -m pytest tests/backend/test_persona.py` 与 `npx playwright test tests/e2e/person-enhance.spec.js tests/e2e/persona-enhancement.spec.js`
- 结果：`33 passed` 与 `9 passed`

## 下一阶段进入条件
- Electron 开发态完成一次“选目录 -> 分析 -> 对比 -> 移除 -> 撤销”可见复验
- 真实照片目录完成一轮误并/漏并观察，确认 identity v2 的收益和边界
- 如可行，打包产物完成至少一轮桌面端冒烟
- 若桌面态或真实目录出现新问题，进入新的修复 + 回归闭环
