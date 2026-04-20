# DedupStudio Identity v2

## 目标

Identity v2 的目标不是“给人物图加分”，而是进一步降低 `dual` 链路里的异人误并，尤其是：

- 同模板、同构图、不同人物
- 同位置、相近姿态、不同服装/肤色
- 轻量统计型 v1 已经逼近上限的 hard case

v2 延续当前产品约束：

- 仍然完全本地
- 仍然不引入重型商用模型
- 仍然保持现有后端接口与前端调用方式不变
- 只增强 identity signal，不改主产品交互

## 为什么从 v1 升到 v2

v1 的 16 维向量主要依赖全局 torso 颜色、布局、边缘和亮度统计。

这条路线对普通异人样本有效，但对“同模板不同人”会失真：

- 两张图共享同一个姿态模板
- torso 全局均值过于接近
- 局部差异被全局平均掉
- 最终把明显异人判成 `same` 或 `uncertain`

基准集里最典型的问题是：

- `same_pose_diff_person.png` vs `same_a.png`

v1 曾把它判成 `same(1.0)`，这是必须修掉的误并。

## v2 设计

### 核心思路

从“全局统计”转为“局部主体差异感知”。

v2 保留 v1 的轻量、可缓存、无额外依赖特性，但加入两个关键局部信号：

- 头区肤色独立检测
- torso 2x2 分块亮度

### 24 维向量结构

1. `0-3`：torso 全局颜色
2. `4-6`：头区肤色信号
3. `7-10`：torso 2x2 分块亮度
4. `11`：torso 块内颜色方差
5. `12`：head-to-torso 亮度差
6. `13-16`：torso 遮罩覆盖统计
7. `17-20`：纵向亮度 profile
8. `21-22`：亮度重心 `(x, y)`
9. `23`：边缘密度

### 判定逻辑

`classify_person_identity()` 现在重点关注以下维度：

- `4-6`：头区肤色亮度/饱和度/skin coverage
- `7-10`：torso 2x2 分块亮度差异
- `0-3`：torso 全局颜色差异
- `12`：头身亮度差变化

主要惩罚项：

- `head_brightness_gap * 0.25`
- `head_sat_gap * 0.20`
- `head_coverage_gap * 0.15`
- `torso_block_gap * 0.30`
- `torso_color_gap * 0.40`
- `head_torso_gap_diff * 0.10`

其中 `torso_color_gap` 在 v2 中从较弱辅助项提升为强信号，用于更有力地区分“同模板不同人”。

## 基准集

### 固定难例集

固定难例集由以下脚本生成：

- `tests/fixtures/build_identity_v2_baseline.py`

生成目录：

- `/tmp/dedup-real-handtest-v1`

基准集说明：

- `same_a.png` / `same_a_copy.png`：完全重复，应判 `same`
- `same_a.png` / `same_b.png`：同人轻微姿态偏移，应判 `same`
- `same_pose_diff_person.png` / `same_a.png`：同模板不同人，必须不再判 `same`
- `same_pose_diff_person.png` / `diff_green.png`：异人 hard case，应判 `different`
- `same_pose_diff_person.png` / `diff_blue.png`：当前最难样本，可接受 `uncertain`

### v2 结果

v2 当前结果：

- `same_a` vs `same_a_copy` → `same(1.0000)`
- `same_a` vs `same_b` → `same(0.9315)`
- `same_pose_diff_person` vs `same_a` → `different(0.5852)`
- `same_pose_diff_person` vs `diff_green` → `different(0.6871)`
- `same_pose_diff_person` vs `diff_blue` → `uncertain(0.9194)`

### 相比 v1 的收益

- `same_pose_diff_person` vs `same_a`：`same(1.0)` → `different(0.5852)`
- `same_pose_diff_person` vs `diff_green`：`uncertain` → `different(0.6871)`
- `diff_blue` 仍未被打成 `different`，但已控制在 `uncertain` fallback，而不是误并为强 `same`

## 缓存版本化

v2 已引入版本化 persona cache：

- 常量：`PERSONA_IDENTITY_VERSION = "v2"`
- cache type：`persona_v2`

这样做的原因：

- 避免 v1 的 16 维缓存污染 v2 的 24 维缓存
- 后续 v3 可以继续沿用同样模式
- identity 试验可以与 API 返回的 `identity_version` 保持一致叙事

## 当前边界

v2 不是重型 face embedding 或 ReID 模型，它仍是轻量 heuristic。

当前边界：

- `diff_blue` 仍可能落在 `uncertain`
- `classify_pose_similarity()` 仍是轻量近似，不是真正关键点模型
- 对无脸远景、多人遮挡、复杂背景场景，v2 仍可能不足

## 下一步建议

如果继续推进 v3，建议优先级如下：

1. 增加局部纹理/颜色块而不是再堆全局统计
2. 视真实目录结果决定是否引入轻量 face/ReID 信号
3. 仅在真实收益明确时再补独立 pose 模型

当前判断：

- v2 已足够作为本地轻量 identity 的主实现继续推进
- 下一阶段重点应放在真实目录复验和 Electron 端验收，而不是立刻引重模型
