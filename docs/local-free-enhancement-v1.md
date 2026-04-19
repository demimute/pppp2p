# DedupStudio 本地免费增强方案 v1

## 目标

在 `Mac mini M4 16G` 上，以完全免费、本地运行、速度可接受的方式，把 DedupStudio 的人物增强链路从当前半成品状态升级为可实际减少误并的本地增强方案。

本方案的核心目标不是“有人像就加分”，而是：

- 降低不同人物误合并
- 提升同人真匹配精度
- 在人物信号不足时回退到原有视觉主链路
- 不依赖云 API
- 不引入付费服务

## 非目标

以下内容不属于 v1 目标：

- 云端视觉服务接入
- 商业付费模型
- 全图库全量重型多模型扫描
- 多人复杂跟踪与跨图关联
- 暴露大量高级参数给最终用户
- 把姿态细化做成主裁决器

## 设计原则

1. `CLIP` 负责候选召回。
2. `pHash` 负责结构过滤。
3. 身份判别负责真正回答“是不是同一个人”。
4. 姿态细化只在同人前提下做 refinement。
5. `different person` 必须能 veto 分组，而不是只改显示分数。
6. 所有增强结果必须缓存，避免重复计算拖慢本机体验。

## 推荐链路

推荐链路如下：

`CLIP -> pHash -> 身份判别 -> 姿态细化`

分层职责：

- `CLIP`：找视觉上可能相近的候选图。
- `pHash`：过滤掉结构差异过大的图。
- 身份判别：判断是否同一人物。
- 姿态细化：只在已确认同人的前提下判断动作/姿态是否接近。

## 本地免费技术选型

### 身份判别主力：InsightFace

用途：

- 人脸检测
- 人脸 embedding 提取
- 同人/异人判别

选型理由：

- 免费，本地可跑
- 对“明显不同的人被误并”最有效
- 对当前真实痛点最有针对性
- 比现有 mock `persona vector` 更接近真实身份判别

接入约束：

- 只在 `dual` 候选成员上触发
- 不做全图库全量扫描
- 检不到脸时返回 `unavailable`

### 姿态细化：MediaPipe Pose

用途：

- 在已确认同人的前提下，估计姿态接近度

选型理由：

- 免费，本地运行
- 轻量，适合桌面工具
- 比复用同一套 persona vector 去近似 pose 更可信

接入约束：

- 只在 `identity_state == same` 时触发
- 不参与第一轮入组
- 只影响排序和轻微细化，不单独放行

### 无脸场景兜底：轻量 ReID（Phase 2）

候选方向：

- `OSNet`
- 轻量 FastReID 路线

用途：

- 当脸不可用时，补充身份信号

说明：

- 这不是 v1 必做项
- v1 先用 face identity 做 veto 即可
- 只有真实照片目录里无脸/侧脸/远景场景明显较多时再补

## v1 判定逻辑

当前 dual 链路建议改为：

1. 用 `CLIP` 建候选组。
2. 用 `pHash` 过滤结构差太远的成员。
3. 对通过前两层的候选成员做身份判别。
4. 若 `identity_state == different`，直接 reject。
5. 若 `identity_state == same`，允许进入姿态细化。
6. 若 `identity_state == uncertain` 或 `unavailable`，保守回退到原主链路，不给正向 boost。
7. `pose_state` 只在同人条件下做微调。

### 成员保留规则

- `different`：直接排除，不进入组。
- `same`：保留，并进入姿态细化。
- `uncertain`：保留，但不做正向加分。
- `unavailable`：保留，完全回退到基础视觉链路。

### 姿态加减分规则

仅当 `identity_state == same` 时：

- `pose_state == close`：轻微正向加分
- `pose_state == far`：轻微负向惩罚
- `pose_state == uncertain / unavailable`：不做加分

姿态结果只能影响排序、细化和组内置信度，不能单独决定是否入组。

## 参数设计

v1 建议只保留一个真实可调参数：

- `identity_penalty_strength`

语义：

- 控制异人惩罚和边界收紧强度
- 但 `different person` 仍应默认作为硬过滤条件

后端建议参数：

- `enhanced_persona: bool`
- `identity_penalty_strength: float`
- `enable_pose_refinement: bool`

v1 暂不向前端暴露姿态强度滑杆，避免 UI 与实现不一致。

## 前端 UI 调整建议

### 保留

- 总开关
- `不同人物强抑制` 滑杆

### 降级

- `同人姿态精细判定` 从假滑杆/静态占位条降级为说明文案

建议文案：

`同人后会自动参考姿态接近度做细化判定，当前为系统内置规则，不支持调节。`

## 后端字段建议

建议 `/api/groups` 统一暴露以下字段：

- `identity_signal_source`
  - `face | reid | fallback | unavailable`
- `person_identity_state`
  - `same | different | uncertain | unavailable`
- `person_identity_score`
- `pose_state`
  - `close | far | uncertain | unavailable`
- `pose_similarity`
- `person_adjustment`
- `decision_reason`
  - 例如：
    - `different_person_hard_reject`
    - `same_person_pose_close_boost`
    - `identity_unavailable_fallback_base`
- `hard_rejected_by_identity`

其中 `hard_rejected_by_identity` 用于解释某成员为什么没有入组。

## 缓存设计

建议缓存以下中间结果：

- face detection 结果
- face embedding
- pose keypoints
- pair-level decision

缓存键建议包含：

- `folder`
- `image_name`
- `file_size`
- `mtime`
- `model_version`

建议补充：

- `face_model_version`
- `pose_model_version`

用于避免模型切换后旧缓存污染新结果。

## 性能策略

为了适配 `Mac mini M4 16G`，必须遵循以下策略：

1. 不对全图库全量跑身份判别和姿态模型。
2. 只在 `dual` 候选组内触发增强模型。
3. 姿态细化只在 `identity_state == same` 时触发。
4. 强制缓存所有可复用中间结果。
5. 可以先返回基础分组，再渐进补充增强标签，避免第一屏阻塞过重。

## 推荐实施顺序

### Phase 1

- 修复 `/api/groups`：把 `different person` 从“只降分”改为“硬过滤”。
- 保持 `CLIP + pHash` 作为候选链路。

### Phase 2

- 用 `InsightFace` 替换当前 mock `persona vector` 的身份判别来源。
- 脸不可用时先回退，不急于补 ReID。

### Phase 3

- 调整前端 UI：移除或降级“同人姿态精细判定”假控件。
- 补充身份 veto 与 decision reason 的可解释展示。

### Phase 4

- 接入 `MediaPipe Pose`。
- 仅在 `same person` 候选上做姿态细化。

### Phase 5

- 根据真实目录效果决定是否补轻量 ReID fallback。

## 当前已确认问题

本方案落地前，已确认以下问题必须纳入待改清单：

1. `/api/groups` 当前 dual 链路中，`different person` 只降分不 veto，导致明显异人仍可能被并入同组。
2. 前端“同人姿态精细判定”当前是静态占位条而非真实可调控件，造成 UI 误导；短期应降级为说明文案，长期再补真实参数与后端接线。

## 结论

DedupStudio v1 应采用 `CLIP + pHash + InsightFace 身份 veto + MediaPipe Pose 同人细化` 的分层本地增强链路，并以候选集按需触发与缓存机制保证其在 `Mac mini M4 16G` 上免费、本机、速度可接受地运行。
