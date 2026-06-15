# Pipeline 内部阶段性能埋点设计

- 日期：2026-05-27
- 状态：草案待评审
- 适用范围：`extrulesproject`（基于 homecheck 框架的 ArkTS 异味检测扩展规则）

## 1. 背景与目标

`extrulesproject` 当前包含 7 个检测器：`LongMethodCheck`、`FeatureEnvyCheck`、`SwitchStatementCheck`、`ForEachArgsCheck`、`CodeCloneType1Check`、`CodeCloneType2Check`、`CodeCloneFragmentCheck`。其中三个克隆类检测器涉及 AST 规范化、Token 化、滑动窗口 Rabin-Karp、克隆类聚合、Type-3 近似匹配等较重的计算阶段。

目标：**在不显著增加生产开销的前提下，按"检测器 × 阶段"粒度量化单次扫描的时间分布，定位瓶颈阶段。**

非目标：

- 不在本期做"按输入规模分阶段"基准（仅保留扩展位）。
- 不替换或对比外部 V8 profiler；不输出 Chrome DevTools timeline。
- 不改变任何检测逻辑、产物或规则配置兼容性。

## 2. 总体方案

在每个 checker 关键阶段调用单例 `PerfReporter` 进行 hrtime 计时，扫描结束时把"检测器 × 阶段"维度的聚合结果写入 `report/perfReport.json`。通过环境变量 `EXTRULES_PERF=1` 启用；未启用时所有计时 API 退化为零开销直通。

不采纳的替代方案：

- **基类 AOP 包裹**：克隆检测器虽可在 `CodeCloneBaseCheck` 集中包裹，但 `LongMethodCheck` / `FeatureEnvyCheck` / `SwitchStatementCheck` / `ForEachArgsCheck` 结构差异较大，AOP 化收益有限；且 `collectMethods` / `collectTokens` 内部子阶段仍需内联标记。
- **`perf_hooks.performance.mark/measure`**：埋点位置与本方案完全相同，仅 API 差异；本期不需要 Chrome DevTools timeline 兼容，先用更直接的 hrtime 实现，保留未来切换可能。

## 3. 模块结构

新增目录与文件：

```
src/Checkers/perf/
  PerfReporter.ts   ← 单例聚合器，导出 record/start/end/time/flush/reset
  types.ts          ← 内部类型（StageRecord、PerfReportShape 等）
  index.ts          ← re-export 公共 API
```

`src/Checkers/index.ts` 不导出 `perf`，避免污染规则 API；仅检测器内部 `import { PerfReporter } from "./perf"` 使用。

## 4. PerfReporter API

```ts
type StageHandle = { end(): void };

interface PerfReporter {
  enabled: boolean;                                          // 由 EXTRULES_PERF 决定
  start(checker: string, stage: string): StageHandle;        // 手动起止
  time<T>(checker: string, stage: string, fn: () => T): T;   // 同步包装
  record(checker: string, stage: string, ns: bigint, count?: number): void;
  flush(filePath?: string): void;                            // 主动落盘
  reset(): void;                                             // 测试用
}
```

- 关闭时：`time(fn) => fn()`、`start()` 返回的 handle 的 `end()` 是空操作、`record()` 直接 return。
- 开启时：使用 `process.hrtime.bigint()` 取纳秒；每个 mark 约 100~200ns。
- 单实例：模块级 `export const PerfReporter = createPerfReporter()`，全局唯一。
- 不做异步追踪（当前 checker 流程同步），如未来引入 async，再追加 `timeAsync<T>`。

聚合字段（每个 `checker × stage` 一条记录）：

| 字段 | 含义 |
| --- | --- |
| `count` | 进入该阶段的次数（例如 `collectMethods` 等于参与扫描的文件数） |
| `totalNs` | 累计耗时 |
| `minNs` / `maxNs` / `avgNs` | 极值与平均 |

为避免暴露内部嵌套结构，本期**不计算 `selfNs`**。如果某阶段内部嵌套了子阶段，父阶段的 `totalNs` 包含子阶段时间；这是已知且文档化的行为，配合 `stage` 命名规约消除歧义。

## 5. 阶段命名规约

- 顶层阶段：直接用方法名，例如 `beforeCheck` / `collectMethods` / `collectTokens` / `afterCheck`。
- 子阶段：`<父阶段>.<子阶段>`，例如 `collectMethods.computeHash`、`afterCheck.merge`。
- 嵌套层级最多两层；不再细分。

## 6. 各检测器埋点清单

| Checker | 顶层阶段 | 子阶段 |
| --- | --- | --- |
| `LongMethodCheck` | `beforeCheck` / `check` | — |
| `FeatureEnvyCheck` | `beforeCheck` / `check` | — |
| `SwitchStatementCheck` | `beforeCheck` / `check` | — |
| `ForEachArgsCheck` | `beforeCheck` / `check` | — |
| `CodeCloneType1Check` / `CodeCloneType2Check`（通过 `CodeCloneBaseCheck`） | `beforeCheck` / `collectMethods` / `afterCheck` | `collectMethods.extractMethodInfo`, `collectMethods.computeHash`, `afterCheck.findClonePairs`, `afterCheck.findNearMissClones`, `afterCheck.reportCloneClasses` |
| `CodeCloneFragmentCheck` | `beforeCheck` / `collectTokens` / `afterCheck` | `collectTokens.readSourceFile`, `collectTokens.removeLogLines`, `collectTokens.tokenize`, `collectTokens.processFile`, `afterCheck.getClonePairs`, `afterCheck.merge`, `afterCheck.dedup`, `afterCheck.findNearMissClones`, `afterCheck.reportGen` |

说明：

- 非克隆类检测器（LongMethod / FeatureEnvy / SwitchStatement / ForEachArgs）继承自 `BaseRuleChecker`，仅暴露 `beforeCheck` 与 `check`（每次访问一个匹配 target 调用一次），无 `afterCheck`。
- `CodeCloneType1Check` 与 `CodeCloneType2Check` 共享 `CodeCloneBaseCheck`，埋点集中在基类；`checker` 字段使用具体子类名（运行时通过 `this.constructor.name` 区分）。
- `check` 阶段的 `count` 即被访问的 target 数（对方法级匹配器等于扫描到的方法数）。

## 7. 报告输出

- 路径：`report/perfReport.json`（与现有 `report/issuesReport.json` 同目录）。
- 触发：
  - 主路径：`process.on('exit', () => PerfReporter.flush())`，进程退出时统一落盘。原因：非克隆检测器没有 `afterCheck` 钩子，而克隆与非克隆检测器在同一进程中跑，必须等所有检测器都跑完才能写完整报告。
  - 辅助：克隆检测器的 `afterCheck` 末尾**可选地**调用一次 `PerfReporter.flush()`，用于在 exit 钩子被屏蔽的环境（例如长驻容器）下提前落盘；`flush()` 为幂等的"覆盖写当前累计"操作。
- 文件结构：

```json
{
  "runId": "2026-05-27T08:23:04.512Z",
  "perfEnabled": true,
  "wallStartIso": "2026-05-27T08:23:04.512Z",
  "wallEndIso": "2026-05-27T08:23:16.844Z",
  "totalWallMs": 12331.7,
  "checkers": {
    "CodeCloneFragmentCheck": {
      "totalMs": 8765.4,
      "stages": {
        "beforeCheck":            { "count": 1,   "totalMs": 4.2,    "avgMs": 4.20,  "minMs": 4.2,  "maxMs": 4.2 },
        "collectTokens":          { "count": 832, "totalMs": 6210.1, "avgMs": 7.46,  "minMs": 0.3,  "maxMs": 412.0 },
        "collectTokens.tokenize": { "count": 832, "totalMs": 3120.2, "avgMs": 3.75,  "minMs": 0.2,  "maxMs": 188.1 },
        "afterCheck":             { "count": 1,   "totalMs": 2551.1, "avgMs": 2551.1,"minMs": 2551.1,"maxMs": 2551.1 },
        "afterCheck.merge":       { "count": 1,   "totalMs": 980.0,  "avgMs": 980.0, "minMs": 980.0,"maxMs": 980.0 }
      }
    }
  }
}
```

字段说明：

- 时间单位在 JSON 中统一为毫秒（保留两位小数），内部存 `bigint` 纳秒。
- `runId` 取 `wallStartIso`，便于 batch 模式拼成时间序列。
- `totalWallMs = wallEndIso - wallStartIso`，由 PerfReporter 自己测量，不依赖外部脚本。

## 8. 与现有 batch 脚本的衔接

不在本期实现，仅约定接口与扩展位：

- `scripts/batchScanRepos.js`：每次 `spawnSync` 后若存在 `report/perfReport.json`，则复制到 `report/batchPerfReports/<repo-safe-name>/perfReport.json`。
- 新增 `scripts/export_batch_perf_metrics.py`（仿 `export_batch_report_metrics.py`）：扫描 `report/batchPerfReports/**/perfReport.json`，输出 CSV 列：`repo, checker, stage, count, totalMs, avgMs, maxMs`。

本期 Plan 不实现以上两项，但 PerfReporter 的 JSON Schema 必须满足上述聚合需求（即按 `checker × stage` 平铺即可，无需额外处理）。

## 9. 开销与正确性保护

- 关闭态：`enabled === false` 时所有 API 提前返回，理论开销为一次属性读 + 一次条件跳转。
- 开启态：
  - 每个 mark 调用 `process.hrtime.bigint()` × 2（start + end），约 200~400ns；
  - 内部聚合用 `Map<checker, Map<stage, StageRecord>>`，更新即原地累加，无对象分配；
  - 单文件子阶段计数约 5~10 次 mark，单文件额外开销 ≈ 2~4 µs，对动辄毫秒级的 tokenize/computeHash 阶段影响 < 1%。
- `flush()` 是 O(total stages) 一次性序列化，扫描结束后调用，不进热路径。
- 异常路径：使用 `try/finally` 确保 `start()` 后即使阶段抛异常，`end()` 也被调用；`time(fn)` 内部用 `try/finally` 实现。

## 10. 测试策略

- 单元测试 `test/perf/PerfReporter.test.ts`：
  - `enabled=false` 时 `time(fn)` 等价于 `fn()`，且不修改内部状态；
  - `enabled=true` 时多次 `record` 后聚合结果正确（count / total / min / max / avg）；
  - `flush()` 写出的 JSON 结构符合 §7 的 schema；
  - `reset()` 清空累计。
- 端到端冒烟：用现有 `*.integration.test.ts` 调度一次完整扫描，环境变量置 `EXTRULES_PERF=1` 后断言 `report/perfReport.json` 存在且 `checkers` 字段不为空、至少包含被触发的检测器条目。
- 不在 CI 跑大仓库基准；性能数据采集是手动行为。

## 11. 不在本期范围

- 不引入按输入规模（LOC / 文件数）的横向对比（属于"按输入规模分阶段"维度，未来通过 batch 脚本叠加即可）。
- 不输出 Chrome DevTools / FlameGraph 格式。
- 不为框架（arkanalyzer / homecheck）内部函数埋点；如需要其下游耗时占比，使用 `node --cpu-prof` 单独获取，与本方案互补。
- 不开放 PerfReporter 作为公共 API；仅 internal use。
