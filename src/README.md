# DedupStudio 前端运行指南

## 项目概述

DedupStudio 的前端基于 Electron + React 18 + Vite + TailwindCSS 构建。

## 环境要求

- Node.js >= 18.0.0
- npm >= 9.0.0
- Python 3.11+ (用于后端)
- Electron 28+

## 安装步骤

```bash
# 1. 安装前端依赖
cd dedup-studio
npm install

# 2. 安装后端依赖 (在 backend 目录)
cd backend
pip install -r requirements.txt
```

## 开发模式运行

需要同时启动前端开发服务器和 Electron：

```bash
# 方式一：一键启动（需要 concurrently）
npm run dev

# 方式二：分别启动

# 终端 1: 启动 Vite 开发服务器
npm run dev:vite

# 终端 2: 启动 Electron
npm run dev:electron
```

Vite 开发服务器运行在 `http://localhost:5173`

## 生产构建

```bash
# 构建前端
npm run build

# 构建 Electron 应用
npm run build:electron
```

## 项目结构

```
src/
├── main.jsx              # React 入口
├── App.jsx               # 根组件
├── components/           # React 组件
│   ├── FolderSelector.jsx    # 文件夹选择（拖拽+按钮）
│   ├── StrategySelector.jsx # 策略选择卡片
│   ├── ThresholdSlider.jsx   # 阈值滑块
│   ├── GroupGrid.jsx         # 相似组网格
│   ├── GroupCard.jsx         # 相似组卡片
│   ├── ComparePanel.jsx       # 对比侧边面板
│   ├── HistoryPanel.jsx      # 底部历史栏
│   └── ConfirmDialog.jsx    # 确认弹窗
├── hooks/                # 自定义 Hooks
│   ├── useApi.js         # API 调用封装
│   ├── useGroups.js      # 分组数据管理
│   └── useHistory.js     # 历史记录管理
└── styles/
    └── index.css         # TailwindCSS 入口 + CSS 变量

electron/
├── main.js               # Electron 主进程
└── preload.js            # 安全桥接脚本
```

## 组件说明

### FolderSelector
- 支持点击按钮打开系统文件夹选择对话框
- 支持拖拽文件夹到应用窗口
- 显示已选路径和图片数量

### StrategySelector
- 4 种策略卡片：A/B/C/D（CLIP/pHash/文件大小/双保险）
- 单选互斥，实时切换

### ThresholdSlider
- CLIP: 0.80 ~ 0.99，步进 0.01
- pHash: 0 ~ 20 Hamming距离，步进 1
- 实时显示预估的移除/保留数量
- 显示推荐阈值标记

### GroupGrid + GroupCard
- 缩略图网格展示
- Winner 用绿色边框标注
- 点击打开 ComparePanel

### ComparePanel
- 侧边滑出面板
- 左图：选中图片，右图：Winner
- 支持键盘快捷键：
  - `K` - 标记保留
  - `R` - 标记移除
  - `S` - 跳过
  - `←/→` - 切换组内图片
  - `Esc` - 关闭面板

### HistoryPanel
- 底部固定栏
- 显示最近操作记录
- 撤销按钮

## 快捷键

| 快捷键 | 功能 |
|--------|------|
| `Cmd/Ctrl + O` | 打开文件夹 |
| `K` | 标记保留 |
| `R` | 标记移除 |
| `S` | 跳过当前 |
| `← / →` | 切换图片 |
| `Esc` | 关闭面板 |

## 深色模式

- 默认跟随系统设置
- 可手动点击右上角图标切换
- 所有颜色使用 CSS 变量，便于统一调整

## API 通信

前端通过 `window.electronAPI` 与后端通信：

```javascript
// 文件夹选择
const result = await window.electronAPI.selectFolder();

// API 调用
const result = await window.electronAPI.apiCall('POST', '/api/groups', params);

// 监听后端就绪
window.electronAPI.onPythonReady(() => {
  console.log('Backend ready');
});
```

## TailwindCSS 配置

暗黑模式使用 `class` 策略，通过 `.dark` 类控制。颜色变量定义在 `src/styles/index.css` 中。
