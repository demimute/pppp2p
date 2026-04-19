# ISSUES

## ISSUE-001: 昨日记录的 Vite 阻塞已失效,问题描述需要纠正
- 发现时间:2026-04-17
- 复验时间:2026-04-18
- 表现:`npm run dev:vite` 当前可正常启动,`npm run build` 也可成功完成,说明"Vite 启动失败"不再是当前阻塞。
- 根因判断:此前记录混入了未复验的假设,状态文件没有被及时回写。
- 当前状态:MITIGATED
- 处理方式:已修正项目状态与下一步目标,后续聚焦 Electron 联调与真实交互缺陷。

## ISSUE-002: Electron 与后端联调未闭环
- 发现时间：2026-04-17
- 表现：Electron 进程可启动，但完整 UI → IPC → API 流程仍缺少可见验证结果。
- 根因判断：IPC 通道已正确建立（preload.js + main.js ipcMain.handle），API 数据流验证待完整 UI 测试。
- 当前状态：OPEN（部分核验通过，后端 API 已实测可用）
- 处理方式：后端 REST API 已实测（scan/groups/hash 均可用）。Electron 完整 UI 测试待进行。

## ISSUE-003: intelligence 数据仅部分在前端展示
- 发现时间：2026-04-17
- 复验时间：2026-04-18
- 表现：前端已显示推荐阈值、建议策略和原因，但分布、备选阈值等数据尚未使用。
- 根因判断：UI 只接了摘要字段，没有完整消费后端 intelligence 结构。
- 当前状态：FIXED
- 处理方式：已添加可展开的 alternatives 备选阈值表格，显示所有阈值的组数/移除数/平均大小。分布数据暂未图形化（低优先级）。

## ISSUE-004: 执行节奏与汇报机制未真正落地
- 发现时间:2026-04-17
- 复盘时间:2026-04-18
- 表现:虽然已有治理文件,但没有把"持续推进"和"10 分钟汇报"变成强制动作,导致中断后无人纠偏。
- 根因判断:只写了静态文档,没有写执行机制,也没有在每轮复验后立刻回写状态。
- 当前状态:MITIGATED
- 处理方式:已新增 `ops/state.json`、`ops/events.jsonl`、watchdog/report 脚本，并创建 10 分钟 cron 汇报任务。后续由主线程只负责主线推进与状态回写。

## ISSUE-005: 对比面板大小差异显示逻辑存在明显缺陷
- 发现时间：2026-04-18
- 表现：`ComparePanel.jsx` 中"大小差异"显示在大于 1KB 时输出百分比，却仍拼接 `KB` 单位，结果会出现数值语义错误。
- 根因判断：显示逻辑把"绝对值 KB"与"百分比"混在同一表达式里。
- 当前状态：FIXED
- 处理方式：修正 `getSizeDeltaText` 为：<1KB 显示 bytes，≥1KB 显示 percentage。

## ISSUE-006: 对比操作状态管理存在闭包陷阱
- 发现时间：2026-04-18
- 表现：`handleCompareAction` 读取 `comparePanel.group.members[selectedIndex].to_remove` 时，该 group 是 ComparePanel 打开时的旧引用，导致快速操作时 stat 计算错误。
- 根因判断：React 函数组件闭包捕获了旧的状态引用。
- 当前状态：FIXED
- 处理方式：添加 `groupsRef` 保持最新 groups 状态引用，`handleCompareAction` 使用 `groupsRef.current` 读取当前成员状态。

## ISSUE-007: phash 策略下 GroupCard 相似度标签显示 Hamming 距离始终为 0
- 发现时间：2026-04-18
- 表现：`GroupCard.getSimilarityLabel` 读取 `member.hamming_distance` 但后端从未设置该字段，导致 phash 策略下始终显示"距离 0"。
- 根因判断：`GroupMember` dataclass 没有 `hamming_distance` 字段，`find_groups_hash` 也没有将其写入返回对象。
- 当前状态：FIXED
- 处理方式：后端在 `GroupMember` 添加 `hamming_distance: int = 0` 字段，`find_groups_hash` 设置该值，API 响应包含该字段。前端使用 `??` 正确处理 undefined。

## ISSUE-008: 负责人让治理动作抢占主线开发
- 发现时间：2026-04-18
- 表现：在 DedupStudio 主线联调未完成时，负责人将大量时间投入到汇报机制和治理补丁，导致主线推进中断。
- 根因判断：没有把“治理只能服务主线、不能抢主线”写成硬约束。
- 当前状态：MITIGATED
- 处理方式：已将当前唯一目标改为主线闭环验证；`NEXT_STEP.md` 明确规定遇到阻塞先修主线阻塞，不允许切去无关治理工作。

## ISSUE-009: Dual 人物判别未参与最终入组裁决
- 发现时间：2026-04-19
- 表现：`/api/groups` 当前 dual 链路里，`different person` 只通过 `person_adjustment` 降分，但成员仍会被追加进入 `new_members`，导致明显异人仍可能被并入同组。
- 根因判断：人物身份判别结果只参与显示分数更新，没有被提升为最终入组门槛或硬过滤条件。
- 当前状态：FIXED
- 处理方式：已将 `person_identity_state == 'different'` 提升为硬过滤条件，成员不再进入 `new_members`；同时返回 `hard_rejected_by_identity` 标记，并补充后端回归测试覆盖该行为。

## ISSUE-010: 同人姿态精细判定 UI 仍为占位控件
- 发现时间：2026-04-19
- 表现：前端“同人姿态精细判定”当前是静态占位条，不具备真实 state、参数下发或后端接线能力，用户容易误以为功能错位或未正确渲染。
- 根因判断：UI 文案已提前收口到“姿态细化”，但前端没有同步实现真实可调控件，当前只是视觉占位。
- 当前状态：OPEN
- 处理方式：短期先降级为说明文案，明确其为系统内置规则；中期再补真实参数、前端状态与后端姿态细化接线。
