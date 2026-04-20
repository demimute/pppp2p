# 人物增强模块重设计

## 目标重定义

当前实现把“人物增强”当作一个额外正向分数源：检测到人物后，基于人物特征相似度给总分加权。这会让模块天然偏向“有人像时更容易归组”。

这不是目标。

新的目标是：

- 在人物场景中减少误合并。
- 尤其是避免“同一位置、不同人物、相似动作/构图”的照片被误判为同组。
- 只有在确认是同一人物且动作姿态也足够接近时，才提高进入同组的置信度。

因此，人物增强模块应从 `persona boost` 改为 `person disambiguation`。

## 核心判定链路

人物增强不再是简单加分项，而是三层判定中的第二层和第三层。

1. 全局视觉相似
- 由现有 CLIP / pHash / 双保险主链路给出。
- 负责背景、构图、局部纹理、整体视觉相近性。

2. 人物身份一致性
- 判断两张图是否都包含主要人物主体。
- 如果都有人物，则进一步判断是否更像“同一人物”还是“不同人物”。
- 这一层主要承担误合并防护。

3. 动作姿态一致性
- 仅在“人物身份一致性较高”时进一步评估。
- 判断动作、站姿、朝向、肢体构型是否接近。
- 这一层主要承担“同一人物不同瞬间”的细分。

## 决策原则

### A. 不同人物：强降分

如果两张图都含人物，但人物身份一致性低：

- 即使背景、位置、构图、动作很像，也应显著拉低最终分数。
- 目的不是绝对禁止成组，而是让它们极难仅凭场景相似进入同组。

这条规则是整个模块的第一优先级。

### B. 同一人物：再看姿态

如果两张图的人物身份一致性高：

- 不能直接认定为重复图。
- 需要继续看动作姿态是否接近。

因为“同一人物”只说明主体可能一致，不说明照片内容重复。

### C. 同人且姿态接近：提高置信度

仅在以下两个条件都满足时，人物模块才应正向提高总分：

- 同一人物概率高。
- 动作姿态接近。

这时它更接近真正的重复、连拍、近重复候选。

### D. 人物信息不足：回退主链路

以下情况不应让人物模块强行主导：

- 人脸过小。
- 背影、遮挡、模糊。
- 人物主体不明确。
- 无法稳定提取姿态或身份特征。

此时应退回现有 CLIP / pHash 主链路，仅把人物模块当作弱参考或不参与。

## 推荐融合逻辑

最终分数不应继续用“统一正向加权”实现，而应拆为：

- `base_similarity`
  来源于现有双保险主链路（CLIP + pHash）。

- `identity_signal`
  表示是否同一人物。

- `pose_signal`
  表示动作姿态是否接近，仅在 identity 高时有效。

- `person_confidence`
  表示人物特征是否足够可靠。

### 建议决策形式

不是：

```text
final = w_clip * clip + w_phash * phash + w_person * persona
```

而是：

```text
if no_reliable_person_signal:
    final = base_similarity
elif different_person_detected:
    final = base_similarity - strong_penalty
elif same_person_detected:
    final = base_similarity + pose_adjustment
else:
    final = base_similarity
```

其中：

- `different_person_detected` 应具备高优先级。
- `pose_adjustment` 应是有上限的小幅精调，而不是压过主链路的主分量。
- `person_confidence` 低时，宁可回退，也不要误杀或误并。

## 对现有实现的偏差

当前后端 `backend/app.py` 的 `dual` 分支中：

- `persona_similarity` 被当作第三个正向分数源。
- `fusion_weights` 以 `clip/phash/persona` 加权融合。
- `persona_boost` 的语义仍然是“人物增强加分”。

这会导致：

- 模块目标偏向“有人物时更容易成组”。
- 无法体现“不同人物时强降分”的优先级。
- 也没有把“姿态判定”作为同人后的第二层筛选。

## 重设计后的后端接口建议

### 请求字段

建议把当前：

- `enhanced_persona`
- `fusion_weights`

演进为更明确的策略字段，例如：

- `person_disambiguation: boolean`
- `identity_penalty_strength: number`
- `pose_refine_strength: number`
- `identity_threshold_same: number`
- `identity_threshold_diff: number`
- `pose_threshold: number`

第一阶段为了兼容，也可以保留旧字段，但内部语义切换为新逻辑。

### 响应字段

建议不要再只返回 `persona_similarity` / `persona_boost`，而是增加：

- `person_identity_score`
- `person_identity_state`: `same | different | uncertain | unavailable`
- `pose_similarity`
- `pose_state`: `close | far | uncertain | unavailable`
- `person_adjustment`
- `final_decision_score`
- `decision_reason`

这样前端才能解释“为什么这两张图没被归到一起”。

## 前端语义重设计

当前前端文案仍然错误地把模块描述为：

- “优先保留或移除包含人物的相似组中的照片”
- “人物相关照片越容易被保留（或移除）”

这些文案会误导用户。

应改为：

- 模块名称可以继续叫“人物增强”，但副标题要明确：
  - “减少不同人物误判为同组”
  - “同人后再结合动作姿态细化判定”

- 控件不应再是“保留人物/移除人物”滑杆。
- 更合理的是两段控制：
  - `不同人物强抑制`
  - `同人姿态精细判定`

## 分阶段实现建议

### Phase 1：纠正语义与决策结构

- 保留现有 persona 特征提取能力。
- 停止把 persona 作为统一正向 boost。
- 先实现：
  - 同人 / 不同人 / 不确定 三态判断。
  - 不同人时强降分。
  - 不确定时回退主链路。

### Phase 2：加入姿态层

- 引入姿态特征或简化人体关键点特征。
- 仅在 identity 为 same 时计算 pose_similarity。
- 用姿态信号做小幅精调，而不是独立主导分组。

### Phase 3：解释性 UI

- 在组卡片和对比面板中展示：
  - 人物身份判断
  - 姿态接近度
  - 本次最终判定受哪一层影响最大

## 验收标准

### 应通过的场景

- 同一地点、不同人物、相似动作：不应轻易成组。
- 同一人物、相似动作、连拍近重复：应更容易成组。
- 同一人物、动作差异明显：可显示相似，但不应高置信误并。
- 无法可靠识别人像：退回原主链路，结果应稳定。

### 不应出现的场景

- 仅因为“都有人物”而整体相似度被明显抬高。
- 不同人物但背景一致时仍被高置信并组。
- 同一人物但不同动作被无脑视为重复。

## 当前代码接入点

- 后端主逻辑：`backend/app.py`
- 人物特征引擎：`backend/engine/persona_engine.py`
- 前端控制入口：`src/App.jsx`
- 策略说明：`src/components/StrategySelector.jsx`
- 组卡展示：`src/components/GroupCard.jsx`
- 对比面板展示：`src/components/ComparePanel.jsx`

## 结论

人物增强模块应从“人物加权器”改为“人物判别器”。

最重要的不是把有人像的图片拉得更近，而是：

- 不同人物时，把它们果断拉开。
- 同一人物时，再用姿态决定能不能真正靠近。

这才符合去重场景下的人物增强目标。
