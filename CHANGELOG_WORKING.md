# CHANGELOG_WORKING

## 2026-04-18
- 复验 `npm run dev:vite` 可正常启动，复验 `npm run build` 可成功产出，确认“Vite 启动失败”已不是当前阻塞。
- 将项目当前主目标改为 Electron -> Renderer -> Backend 联调验证，并同步修正 `PROJECT_STATUS.md`、`NEXT_STEP.md`、`ISSUES.md`。
- 新增执行复盘：此前停滞的根因不是缺少文档，而是缺少“复验后立刻回写状态”和“10 分钟汇报”机制。
- 修复 `src/components/ComparePanel.jsx` 中大小差异显示逻辑错误，改为同时显示绝对差值与百分比。
- 再次执行 `npm run build`，验证前端改动未破坏构建。

## 2026-04-17
- 初始化 `dedup-studio/` 项目目录与 Git 仓库。
- 创建并提交 `SPEC.md`。
- 生成后端骨架：`backend/app.py`、`backend/cache.py`、`backend/models.py`、`backend/engine/*`。
- 生成前端骨架：`electron/*`、`src/*`、`package.json`、`vite.config.js` 等。
- 修正前后端端口统一到 `5000`。
- 修正前后端策略名兼容：`clip/phash/filesize/dual`。
- 前端分析前补充 `/api/embed`、`/api/hash` 预计算逻辑。
- 将 CLIP 分组策略调整为更接近 winner direct compare。
- 新增 `backend/engine/intelligence.py`。
- 为后端新增 `/api/analyze` 与 intelligence 返回。
- 独立验证后端：`POST /api/scan` 成功，真实目录返回 `total = 135`。
- 发现并记录 Vite 运行时问题与 Electron 联调未闭环问题。
- 建立治理文件：`PROJECT_STATUS.md`、`NEXT_STEP.md`、`ISSUES.md`、`CHANGELOG_WORKING.md`。
