# PPPP2P 开发档案（2026-04 归档）

## 1. 项目定位

PPPP2P 是一个本地优先的照片去重桌面工具，目标不是做“全自动一键清库”，而是提供一套足够快、足够稳、可人工复核的重复照片整理工作流。

项目的核心原则一直比较明确：

- 本地运行，不依赖云端 API。
- 先给出候选分组，再由用户做最终确认。
- 任何删除动作都必须具备撤销能力。
- 桌面端体验优先，浏览器态主要服务于开发与测试。
- 在相似图判断上，优先降低明显误并风险，而不是盲目追求更多召回。

## 2. 当前归档结论

截至本次归档，PPPP2P 已经完成一轮较完整的桌面工具工程化收口，具备以下可用能力：

- Electron 桌面应用壳。
- React 前端主界面。
- Flask 后端分析服务。
- 基于 CLIP 与感知哈希的分组链路。
- 基于 identity/persona 的增强判别链路。
- 人工保留项选择、批量移除、撤销、历史记录。
- 基本验收文档、性能调优、Windows 打包初步收口。

项目目前不是“从零到一未完成”，而是“主体已经成型，但仍保留少量重要尾项”，其中最关键的是 Windows 自包含发布链路仍未完全闭环。

## 3. 技术架构

### 3.1 前端

- `React 18`
- `Vite`
- 页面入口：`src/App.jsx`

前端职责：

- 选择目录
- 发起扫描/分析
- 展示分组结果
- 打开组内对比面板
- 标记保留/移除
- 触发移除、撤销、历史查看
- 展示后端状态与桌面态信息

### 3.2 桌面壳

- `Electron`
- 主进程入口：`electron/main.js`
- preload：`electron/preload.js`

桌面壳职责：

- 创建窗口与菜单
- 启动或接管本地后端
- 提供目录选择 IPC
- 转发前端 API 调用到本地 Flask 服务
- 处理打包态下内置后端定位

当前主进程已经支持：

- 启动时探测端口 `18765`
- 若已有后端则接管为 `external`
- 若无后端则尝试启动内置后端为 `managed`
- 将后端状态实时透传给前端
- Windows 打包态下从 `resources/backend/backend.exe` 等候选位置寻找后端可执行文件

### 3.3 后端

- `Flask`
- 主入口：`backend/app.py`

后端职责：

- 扫描目录图片
- 生成 embedding、hash、persona/identity 特征
- 按策略生成分组
- 记录历史与撤销栈
- 持久化部分偏好配置

关键模块：

- `backend/engine/clip_engine.py`
- `backend/engine/hash_engine.py`
- `backend/engine/similarity.py`
- `backend/engine/persona_engine.py`
- `backend/engine/intelligence.py`
- `backend/engine/scene_classifier.py`

## 4. 核心功能现状

### 4.1 已完成主流程

当前版本已经形成完整工作流：

1. 用户选择照片目录。
2. 系统扫描目录中的图片文件。
3. 通过相似度链路生成候选分组。
4. 用户进入组内对比面板检查候选项。
5. 用户指定每组保留项或待移除项。
6. 系统执行移除，并将结果写入新的输出目录。
7. 用户可对最近操作执行撤销。
8. 历史记录面板可显示最近处理动作。

### 4.2 分组策略能力

项目已经从较早期的单一相似度逻辑，演进到更稳的多层链路：

- `CLIP` 负责召回视觉相近候选。
- `pHash` 负责结构相似过滤。
- `identity/persona` 负责回答“是不是同一个人”。
- `pose refinement` 只在同人前提下做轻量细化。

这部分不是停留在文档层，而是已经有后端实现、前端展示和测试覆盖。

### 4.3 桌面运行能力

Electron 已经不再只是一个简单 web 壳，已补齐以下关键桌面行为：

- 后端复用外部已存在服务，避免重复拉起导致端口冲突。
- 后端状态对前端可见，区分 `managed / external / error / stopped`。
- 菜单与文件夹选择 IPC 可用。
- 开发态优先使用本地资源，打包态支持内置资源路径。

## 5. 主要开发时间线

以下时间线聚焦近几轮关键收口，不追求列出所有小修补。

### 5.1 2026-04-18

阶段重点：主线功能完成，开始桌面端打包与工程化收口。

已知结果：

- 主线 4 项任务基本跑通。
- 成功产出 macOS `dmg`。
- Apple Silicon 主机上 Windows 打包因 `Wine/rcedit` 限制存在问题，但能得到可用的 `win-arm64-unpacked` 产物。
- 进度与报告系统得到改进。

### 5.2 2026-04-19

阶段重点：人物增强链路重构与主线程收口。

关键成果：

- 前端去掉旧 `fusion_weights` 主逻辑，统一到“人物身份判别与姿态细化”语义。
- 后端 `/api/groups` 接入 `compute_person_disambiguation` 等新链路。
- Electron 启动逻辑修复，能够容忍外部已存在后端。
- 验证通过：`npm run build`、人物增强相关 Playwright 用例、后端测试。
- 写入验收记录 `docs/acceptance-2026-04-19.md`。

关键提交：

- `57d67d8` `fix: align person disambiguation integration`
- `2cf6801` `fix: tolerate existing backend in electron`
- `7c7abd5` `fix: surface backend readiness and acceptance status`

### 5.3 2026-04-20

阶段重点：继续修问题并准备进入 Electron/真实目录联合复验。

关键成果：

- `/api/groups` 返回补齐 `identity_version`。
- 人物增强相关测试继续通过。
- Playwright 主流程通过。
- 写入 `docs/electron-acceptance-2026-04-20.md`，明确桌面端手测清单。

关键提交：

- `2b5d33f` `fix: add missing identity_version field to /api/groups response`

### 5.4 2026-04-21

阶段重点：性能与发布收口。

关键成果：

- `hash + dual` 分组 pipeline 优化。
- CLIP 冷启动优化。
- CLIP prewarm 移出 scan 关键路径。
- 版本升级到 `1.0.1`。
- Windows x64 便携打包 workflow、产物命名修复、`.gitignore` 完善。
- 后端 persona 测试提升到 `37 passed`。

关键提交：

- `520e5a6` `hash + dual` pipeline 优化
- `b9d399d` CLIP 冷启动优化
- `9fb5617` CLIP prewarm 路径优化

### 5.5 2026-04-22

阶段重点：Windows 自包含打包故障排查。

最终确认结论：

- 最新 Windows artifact 解压后，`resources` 下只有 `app.asar` 和 `elevate.exe`，没有 `backend.exe`。
- 说明所谓“自包含 Windows 包”仍未真正把后端打进最终产物。
- 已形成明确下一步：在 GitHub Actions 的 Windows workflow 中加入打包前后验货，若关键位置缺失 `backend.exe`，应直接 fail，不能继续上传坏包。

## 6. 关键提交索引

以下提交是当前阶段最值得回看的里程碑：

- `ee6f43c` `feat: add scene labels for screenshot burst and chat groups`
- `451fc63` `chore: default dev flow to electron-only`
- `158371d` `feat: simplify persona tuning and show analysis progress`
- `ad3f262` `feat: redesign desktop workflow for simpler review`
- `fd01620` `feat: streamline PPPP2P review workflow UI`
- `a653509` `feat: persist winner choices and add quick grid toggles`
- `366b4e9` `fix: persist manual keep states across reanalysis`
- `57d67d8` `fix: align person disambiguation integration`
- `2cf6801` `fix: tolerate existing backend in electron`
- `8d52932` `fix: bundle and resolve backend exe reliably`

## 7. 文档资产清单

项目已经不是“代码有了，文档没有”的状态，现有文档包括：

- `docs/acceptance-2026-04-19.md`
  - 人物增强验收记录。
- `docs/electron-acceptance-2026-04-20.md`
  - Electron 桌面端验收计划。
- `docs/identity-v2.md`
  - identity v2 设计说明。
- `docs/local-free-enhancement-v1.md`
  - 本地免费增强链路方案。
- `docs/persona-enhancement-redesign.md`
  - 人物增强重构设计说明。
- `docs/windows-portable-readme.txt`
  - Windows 绿色版分发说明。
- `README.md`
  - 本次归档新增总入口。
- `docs/user-manual.md`
  - 本次归档新增用户手册。

## 8. 已验证事项

根据当前记忆与文档，以下事项已被明确验证过：

- `npm run build` 可通过。
- `pytest tests/backend/test_persona.py` 在收口阶段已达到 `37 passed`。
- Playwright 人物增强相关两组用例通过。
- 浏览器态主流程复验通过。
- Electron 已至少完成后端接管与桌面运行侧的关键修复。

需要注意的是：

- 桌面端“等价于 web E2E 的完整自动化”仍然不足。
- Electron 侧仍主要依赖手测清单与启动链路验证，而非完整 UI 自动化。

## 9. 已知问题与风险

### 9.1 Windows 自包含包未完全闭环

这是当前最重要的遗留问题。

现状：

- Windows artifact 可能缺少 `backend.exe`。
- 用户拿到包后可能无法真正独立运行。
- 虽然 `electron/main.js` 已增加多候选路径定位逻辑，`package.json` 也声明了 `extraResources`，但 CI 产物层面仍未完全证明打包链路可靠。

影响：

- 这是发布级问题，不修复会直接影响最终用户可用性。

### 9.2 Electron 自动化覆盖不足

现状：

- 主流程更多依赖 web E2E。
- Electron 启动与接管逻辑虽已修复，但缺少足够完整的桌面 UI 自动化回归。

影响：

- 当桌面壳、preload、打包路径、IPC 出现变更时，现有自动化对问题的提前发现能力有限。

### 9.3 人物增强链路仍有继续迭代空间

现状：

- 轻量 identity v1/v2 已显著优于早期 mock 方案。
- 但在“同模板不同人”“无脸或弱脸场景”下，纯轻量 heuristic 的上限已经显现。

影响：

- 后续如果要继续提升真实目录效果，可能需要按文档方案逐步引入更可靠的 face identity 或 ReID fallback。

## 10. 后续优化建议

### 10.1 第一优先级：修复 Windows 发布链路

建议直接执行：

1. 在 GitHub Actions Windows workflow 中加入构建前检查：
   - `dist/backend.exe`
   - `backend/backend.exe`
2. 在 electron-builder 输出后加入构建后检查：
   - `dist-electron/win-unpacked/resources/backend.exe`
   - 或 `dist-electron/win-unpacked/resources/backend/backend.exe`
3. 若缺失，workflow 直接失败。
4. 对 artifact 解压结果做一次脚本化验货，避免继续上传坏包。

### 10.2 第二优先级：补桌面端真正的冒烟回归

建议补一套围绕 Electron 的最小冒烟验证，至少覆盖：

- 应用启动
- 后端 ready 状态
- 目录选择
- 发起分析
- 打开 compare panel
- 执行移除
- 执行撤销

### 10.3 第三优先级：继续提高 identity 质量

如果未来继续做识别质量优化，建议遵循现有文档路线：

- 先保持 `CLIP -> pHash -> identity -> pose refinement` 分层结构不变。
- 优先增强“different person 的 veto 可靠性”。
- 只在必要时引入 face model / ReID fallback，不要重新把系统拉回全量重型扫描。

## 11. 接手建议

如果未来重新启动 PPPP2P 的开发，建议按下面顺序接手：

1. 先阅读本档案，了解项目已经完成到什么程度。
2. 再阅读 `docs/user-manual.md`，确认当前产品行为和对用户的承诺。
3. 如果目的是恢复发布，优先处理 Windows 自包含包问题。
4. 如果目的是继续提升识别效果，再转看 `docs/local-free-enhancement-v1.md` 和 `docs/identity-v2.md`。
5. 任何功能继续开发前，先做一轮本地验证：
   - `npm run build`
   - `pytest tests/backend/test_persona.py`
   - 必要的 Electron 手测

## 12. 归档结语

PPPP2P 现在最适合被理解成一个“已经做成 80% 到 90%，并且最难的主线已经跑通”的项目，而不是一个散乱原型。核心价值、主要交互和主技术路径都已经稳定，剩下的问题更偏工程化闭环与发布可靠性。

因此这次归档的目的不是宣告结束，而是把项目冻结在一个将来可以低成本恢复推进的位置上。只要后续按本文档接手，重新进入状态的成本会比从历史提交和碎片对话里重新打捞低得多。
