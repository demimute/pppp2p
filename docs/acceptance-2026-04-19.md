# DedupStudio 验收摘要（2026-04-19）

## 本轮目标

将“人物增强识别”从旧的 persona boost / fusion_weights 叙事，收口到“人物身份判别 + 异人惩罚 + 同人姿态细化”的真实去重目标，并确认不会打坏既有 compare/remove/undo/history 主链路。

## 关键提交

- `57d67d8` `fix: align person disambiguation integration`
- `2cf6801` `fix: tolerate existing backend in electron`

## 已完成改动

- 前端 `src/App.jsx`
  - 去掉旧 `fusion_weights` 请求。
  - Dual 策略请求改为发送 `enhanced_persona` 与 `identity_penalty_strength`。
  - 人物增强 UI 改为围绕“人物身份判别与姿态细化”表述。
- 后端 `backend/app.py`
  - `/api/groups` 改为以人物身份判别/异人惩罚为主链路。
  - `fusion_weights`、`persona_boost` 仅保留最小兼容语义。
- Electron `electron/main.js`
  - 若 18765 端口已有后端服务，Electron 直接复用，不再把端口冲突视为启动失败。
  - 补充后端状态来源识别：managed / external / error / stopped。
- 测试
  - 人物增强相关 Playwright 断言文案已全部对齐新语义。

## 已验证结果

- `npm run build` 通过
- `python3.11 -m pytest tests/backend/test_persona.py` → `28 passed`
- `npx playwright test tests/e2e/person-enhance.spec.js tests/e2e/persona-enhancement.spec.js --reporter=line` → `9 passed`
- `npx playwright test tests/e2e/workflow.spec.js tests/e2e/compare-shortcuts.spec.js tests/e2e/multi-group-history.spec.js tests/e2e/repeated-undo.spec.js --reporter=line` → `4 passed`

## 当前可手测路径

1. 启动 DedupStudio Electron。
2. 选择包含以下混合场景的目录：
   - 同一人物、相近姿态
   - 不同人物、相近姿态
   - 普通重复图
3. 选择“双保险”。
4. 观察人物判别卡、分组结果、ComparePanel、执行移除、撤销、历史记录。
5. 重点确认“同位置不同人物相似姿态”不会再被误并。

## 剩余风险

- 仍缺少完整 Electron UI 自动化，当前主要依赖 web 回归 + Electron 启动链路验证。
- `src/App.jsx` 内部仍有一部分旧短文案，需要与 `StrategySelector.jsx` 保持完全一致。
- 后端状态虽然已可从主进程读取，但前端展示仍需保持简洁，避免把低层 stderr 原文直接铺给用户。
