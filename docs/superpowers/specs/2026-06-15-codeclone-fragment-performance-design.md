# CodeCloneFragment 语义兼容性能优化设计

## 背景

`大仓测试_1.md` 中的高重复项目 `ostest_integration_test` 显示，`CodeCloneFragmentCheck` 占总检测耗时 98.9%，其中 `afterCheck.dedup` 单次耗时 1,354,781.21ms。上一轮已经把 `deduplicateMergedClones` 的全局线性扫描改成按文件对和行桶索引的选择逻辑，并补充了“重叠克隆保留最大 tokenCount”的回归测试。

这轮允许大范围重构，但正确性口径改为语义兼容优先：不要求报告数量、排序、pair 展开完全一致；要求语义上应报的克隆仍被报告，报告边界可解释，误报不过度扩大，测试样例覆盖的 Type-1/Type-2/Type-3 场景保持成立。

参考实现：

- PMD/CPD：保留 token 级 minimum tokens、identifier/literal 规范化、Karp-Rabin 精确匹配主线。
- NiCad：借鉴函数/块粒度、规范化/过滤、clone class-first 输出和近似阈值比较，避免在高重复代码中先枚举所有 pair。

## 目标

1. 消除精确克隆路径中的高重复 pair 爆炸。
2. 保留现有配置含义：`minimumTokens`、`normalizeIdentifiers`、`normalizeLiterals`、`ignoreLogs`、`minDistinctTokenTypes`、`enableCloneClasses`、`similarityThreshold`、`maxPairsPerFingerprint`。
3. 在默认 `enableCloneClasses=false` 时仍输出 pair 风格 issue，但内部不再依赖全量 pair 生成。
4. 在 `enableCloneClasses=true` 时优先使用 class-first 结果生成克隆类报告。
5. 为每轮优化保留可重复的 correctness 和 performance 证据。

## 非目标

1. 不引入外部二进制工具、PMD、NiCad、TXL 或 Java 运行时依赖。
2. 不改变 homecheck 规则注册方式。
3. 不把大仓测试数据纳入仓库。
4. 不在第一轮实现完整 NiCad 式语法级函数抽取；先基于现有 token/location/cache 实现 class-first 精确路径。

## 方案

第一轮实现 `CloneMatcher.getExactCloneGroups()`。它复用当前 hash index 和惰性 fingerprint 校验，但返回 fingerprint group，而不是展开 `n * (n - 1) / 2` 个 `ClonePair`。每个 group 包含重复 token 窗口的位置列表、tokenCount 和 fingerprint。高重复样板片段会成为一个 group，而不是上千上万 pair。

新增 `ExactCloneClassBuilder`，把重复窗口组转换为可报告的克隆类候选：

1. 对每个 fingerprint group 按文件和起始 token 排序。
2. 过滤同文件自重叠窗口，保留不同文件或同文件非重叠成员。
3. 按文件维护最后一个已接受成员，避免为跨文件成员扫描全部已选成员。
4. 输出 `MergedCloneClass`，其中包含 classId、members、tokenCount。
5. 默认 pair issue 由每个 clone class 的前两个稳定成员派生；clone class issue 直接使用全部成员。

现有 `getClonePairs -> merge -> dedup` 先保留为兼容 fallback 和回归对照。`CodeCloneFragmentCheck.afterCheck` 在精确路径上改用 class-first：

1. `afterCheck.getExactCloneGroups`
2. `afterCheck.buildExactCloneClasses`
3. `afterCheck.reportGen`

`maxPairsPerFingerprint` 在新语义下改为“单个 fingerprint group 最多参与 pair fallback 的位置数量”，不是主路径的候选对数量。后续第二轮再把 Type-3 `NearMissDetector.detect()` 从全量块两两比较改为 size band + q-gram bucket 候选。

## 数据结构

`ExactCloneGroup`：

- `fingerprint: string`
- `locations: FragmentLocation[]`
- `tokenCount: number`

`MergedCloneClass`：

- `classId: number`
- `members: MergedCloneMember[]`
- `tokenCount: number`

`MergedCloneMember`：

- `file: string`
- `startLine: number`
- `endLine: number`
- `startIndex: number`
- `endIndex: number`

## 正确性策略

1. 保留现有 `RuleOutputRegression.test.ts`，若默认 pair issue 数量变化，需要用语义断言补足并人工确认变化来自 class-first 去重，而不是漏报。
2. 新增单元测试验证：
   - 一个 fingerprint group 多个位置时不会展开二次方 pair。
   - clone class 成员稳定排序。
   - 同文件重叠窗口不成为同一可报告 class 的多个成员。
   - 默认 pair report 从 class 前两个成员稳定派生。
3. 新增高重复压力测试，构造 1000 个重复窗口，断言 group/class 数量随重复度近似线性，不随 pair 数二次方增长。
4. 保留完整 `npm test -- --runInBand` 和 `npm run build` 作为交付门禁。

## 性能策略

1. 增加精确路径子阶段埋点：`afterCheck.getExactCloneGroups`、`afterCheck.buildExactCloneClasses`。
2. 保留旧阶段名称对照到新阶段：`afterCheck.getClonePairs` 只在 fallback 或测试中使用。
3. 用本地微基准记录同一高重复合成输入的 before/after：输入重复窗口数、输出 clone class 数、耗时。
4. 目标是第一轮把高重复精确克隆的候选展开从 O(k²) 降到 O(k log k) 或 O(k)，其中 k 是同 fingerprint 位置数量。

## 交付顺序

1. 写 class-first 数据结构和构建器测试。
2. 实现 `getExactCloneGroups()`。
3. 实现 `ExactCloneClassBuilder`。
4. 改造 `CodeCloneFragmentCheck.afterCheck` 精确路径。
5. 更新回归测试和文档，记录性能对比。
6. 第二轮再处理 Type-3 近似克隆候选裁剪。

## 风险

1. 默认 pair report 由 clone class 派生后，数量可能减少。按语义兼容口径，这是可接受的，但需要测试证明样例语义仍覆盖。
2. 如果只按 fingerprint group 建 class，可能得到较短的 minimumTokens 级别片段。第一轮用稳定可解释报告换取可完成性；后续可继续做相邻 group 合并。
3. 高重复代码中 class 成员可能很多，reportGen 需要避免描述过长。默认 pair issue 只展示两个成员，clone class 模式可以后续增加成员数量上限。
