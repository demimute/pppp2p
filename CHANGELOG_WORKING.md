# CHANGELOG_WORKING

## 2026-04-18 (continued)

### Test & Stability

- **Browser-side API base fix** (`src/hooks/useApi.js`): Playwright/browser requests no longer hardcode `http://localhost:5000`; browser mode now uses relative `/api`, while Electron keeps direct backend access.
- **Compare/remove workflow stabilization** (`src/App.jsx`, `src/components/ComparePanel.jsx`, `tests/e2e/workflow.spec.js`): fixed winner-removal inconsistency and tightened locators/assertions so compare -> mark remove -> execute remove -> undo runs reliably.
- **Keyboard shortcut coverage** (`tests/e2e/compare-shortcuts.spec.js`): added dedicated E2E coverage for `ArrowLeft` / `ArrowRight` / `k` / `r` / `s` / `Escape`, then aligned assertions with real focus behavior inside `ComparePanel`.
- **Multi-group undo assertions** (`tests/e2e/multi-group-history.spec.js`): replaced brittle expectations for a standalone `已撤销` badge with stable signals from restore feedback and timestamped history entries.
- **Repeated undo fixture isolation** (`tests/e2e/repeated-undo.spec.js`): first isolated disk fixtures, then switched to per-worker temp folders to avoid parallel Playwright interference in repeated remove/undo flows.
- **Stale undo/history cleanup for rebuilt folders** (`backend/app.py`): `/api/scan` now clears per-folder undo/history state when a rebuilt source folder no longer has its paired `-已去重` directory, preventing false history leakage across reruns.
- **Repeated confirm dialog hardening** (`tests/e2e/repeated-undo.spec.js`): confirmation checkbox handling was made explicit and retryable so modal confirmation does not flap on rerender.

### Verification

- `npx playwright test tests/e2e/workflow.spec.js tests/e2e/compare-shortcuts.spec.js tests/e2e/multi-group-history.spec.js tests/e2e/repeated-undo.spec.js` → `4 passed (2.9s)`
- Related commits during this stabilization wave: `dedafab`, `7fa4787`, `54f0f91`, `de5b368`, `56176f4`, `7b15c3f`

### Bug Fixes

- **ComparePanel size delta display** (`ComparePanel.jsx`): `getSizeDeltaText` showed mixed KB+percentage for larger differences, causing semantic confusion. Fixed to show percentage only for larger differences (>1KB), bytes only for small differences.
- **ComparePanel stale closure** (`App.jsx`): `handleCompareAction` read `member.to_remove` from `comparePanel.group` (stale reference) when computing stat delta. Fixed by adding `groupsRef` to always read the current groups state.
- **phash hamming_distance missing** (`backend/models.py`, `backend/engine/similarity.py`, `backend/app.py`): `GroupCard.getSimilarityLabel` for phash read `member.hamming_distance` which was never set by the backend. Fixed by adding `hamming_distance` field to `GroupMember` dataclass and setting it in `find_groups_hash`, and including it in the API response. Also added `hamming_distance` for dual strategy.

### UI Improvements

- **Intelligence card alternatives** (`App.jsx`): Added expandable alternatives table to the intelligence card, showing all threshold candidates with group count, to_remove, and avg_group_size.
- **Duplicate code cleanup** (`App.jsx`): Removed duplicate `const { contextBridge, ipcRenderer } = require('electron');` line that was accidentally included in main.js (the real preload.js correctly uses it).

### Verification

- Backend restarted with updated code. Verified `/api/groups` for phash now returns `hamming_distance` in member objects. Verified `npm run build` succeeds with all frontend changes.

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
