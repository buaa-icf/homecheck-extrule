# Pipeline Perf Instrumentation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 `extrulesproject` 的 7 个检测器中按"检测器 × 阶段"打点，扫描结束时输出 `report/perfReport.json`；通过 `EXTRULES_PERF=1` 启用，默认关闭时为零开销直通。

**Architecture:** 单例 `PerfReporter`（`src/Checkers/perf/`）使用 `process.hrtime.bigint()` 聚合 `count / totalNs / minNs / maxNs`，进程退出时统一 flush。`BaseRuleChecker.beforeCheck` 集中埋点覆盖所有 checker；非克隆检测器在自身 `check` 包裹一次；`CodeCloneBaseCheck` 与 `CodeCloneFragmentCheck` 在 `collect*` / `afterCheck` 及其内部关键函数包裹。

**Tech Stack:** TypeScript 5.9 + Node.js（CommonJS）+ Jest 30 (`ts-jest`)，遵循 `tsconfig.main.json`（`strict: true`）。

**Spec:** `docs/superpowers/specs/2026-05-27-pipeline-perf-instrumentation-design.md`

---

## File Structure

新建：

- `src/Checkers/perf/types.ts` — 内部类型（StageRecord、PerfReportShape、StageHandle 等）
- `src/Checkers/perf/PerfReporter.ts` — 单例聚合器与 `createPerfReporter` 工厂
- `src/Checkers/perf/index.ts` — re-export 公共 API（`PerfReporter`, `createPerfReporter`, 类型）
- `test/perf/PerfReporter.test.ts` — 单元测试
- `test/perf/PerfReporterIntegration.test.ts` — 端到端冒烟

修改：

- `src/Checkers/BaseRuleChecker.ts` — 在 `beforeCheck` 中调用 `PerfReporter.time`
- `src/Checkers/LongMethodCheck.ts` — 包裹 `check` 箭头函数体
- `src/Checkers/FeatureEnvyCheck.ts` — 同上
- `src/Checkers/SwitchStatementCheck.ts` — 同上
- `src/Checkers/ForEachArgsCheck.ts` — 同上
- `src/Checkers/CodeCloneBaseCheck.ts` — 包裹 `collectMethods` / `afterCheck` 及内部 `extractMethodInfo` / `computeHash` / `findClonePairs` / `findNearMissClones` / `reportCloneClasses`
- `src/Checkers/CodeCloneFragmentCheck.ts` — 包裹 `collectTokens` / `afterCheck` 及内部 `readSourceFile` / `removeLogLines` / `tokenize` / `processFile` / `getClonePairs` / `merge` / `dedup` / `findNearMissClones` / `reportGen`

---

### Task 1: PerfReporter 类型定义

**Files:**
- Create: `src/Checkers/perf/types.ts`

- [ ] **Step 1: 创建类型文件**

```ts
// src/Checkers/perf/types.ts

/** start() 返回的句柄，调用 end() 记录时间。 */
export interface StageHandle {
    end(): void;
}

/** 单个阶段的内部累计记录（纳秒）。 */
export interface StageRecord {
    count: number;
    totalNs: bigint;
    minNs: bigint;
    maxNs: bigint;
}

/** flush 时单阶段的 JSON 形态（毫秒，两位小数）。 */
export interface StageRecordJson {
    count: number;
    totalMs: number;
    avgMs: number;
    minMs: number;
    maxMs: number;
}

/** 单检测器的 JSON 形态。 */
export interface CheckerReportJson {
    /** 仅累加顶层阶段（不含名称带"."的子阶段），避免重复计算。 */
    totalMs: number;
    stages: Record<string, StageRecordJson>;
}

/** 完整 perfReport.json 形态。 */
export interface PerfReportShape {
    runId: string;
    perfEnabled: boolean;
    wallStartIso: string;
    wallEndIso: string;
    totalWallMs: number;
    checkers: Record<string, CheckerReportJson>;
}
```

- [ ] **Step 2: 编译检查**

Run: `npx tsc -p ./tsconfig.main.json --noEmit`
Expected: 0 errors（暂未被引用，但确保类型本身合法）。

- [ ] **Step 3: 提交**

```bash
git add src/Checkers/perf/types.ts
git commit -m "feat(perf): add PerfReporter type definitions"
```

---

### Task 2: PerfReporter 单元测试（先写测试）

**Files:**
- Create: `test/perf/PerfReporter.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
// test/perf/PerfReporter.test.ts
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { createPerfReporter } from '../../src/Checkers/perf/PerfReporter';
import { PerfReportShape } from '../../src/Checkers/perf/types';

describe('PerfReporter (disabled)', () => {
    it('time(fn) 直接调用 fn 且不记录任何数据', () => {
        const reporter = createPerfReporter(false);
        const result = reporter.time('CheckerA', 'beforeCheck', () => 42);
        expect(result).toBe(42);
        const json = reporter.toJSON();
        expect(json.perfEnabled).toBe(false);
        expect(json.checkers).toEqual({});
    });

    it('start().end() 是 no-op', () => {
        const reporter = createPerfReporter(false);
        const handle = reporter.start('CheckerA', 'beforeCheck');
        handle.end();
        expect(reporter.toJSON().checkers).toEqual({});
    });

    it('record() 直接返回，不修改状态', () => {
        const reporter = createPerfReporter(false);
        reporter.record('CheckerA', 'beforeCheck', 1_000_000n);
        expect(reporter.toJSON().checkers).toEqual({});
    });

    it('flush() 不写文件', () => {
        const reporter = createPerfReporter(false);
        const tmp = path.join(os.tmpdir(), `perf-disabled-${Date.now()}.json`);
        reporter.flush(tmp);
        expect(fs.existsSync(tmp)).toBe(false);
    });
});

describe('PerfReporter (enabled)', () => {
    it('record() 累加 count/total 并更新 min/max', () => {
        const reporter = createPerfReporter(true);
        reporter.record('CheckerA', 'check', 1_000_000n); // 1ms
        reporter.record('CheckerA', 'check', 3_000_000n); // 3ms
        reporter.record('CheckerA', 'check', 2_000_000n); // 2ms

        const json = reporter.toJSON();
        const stage = json.checkers['CheckerA'].stages['check'];
        expect(stage.count).toBe(3);
        expect(stage.totalMs).toBeCloseTo(6.00, 2);
        expect(stage.avgMs).toBeCloseTo(2.00, 2);
        expect(stage.minMs).toBeCloseTo(1.00, 2);
        expect(stage.maxMs).toBeCloseTo(3.00, 2);
    });

    it('time(fn) 返回 fn 结果并记录耗时', () => {
        const reporter = createPerfReporter(true);
        const result = reporter.time('CheckerA', 'beforeCheck', () => 'ok');
        expect(result).toBe('ok');
        const stage = reporter.toJSON().checkers['CheckerA'].stages['beforeCheck'];
        expect(stage.count).toBe(1);
        expect(stage.totalMs).toBeGreaterThanOrEqual(0);
    });

    it('time(fn) 抛异常时仍记录耗时', () => {
        const reporter = createPerfReporter(true);
        expect(() => reporter.time('CheckerA', 'beforeCheck', () => {
            throw new Error('boom');
        })).toThrow('boom');
        const stage = reporter.toJSON().checkers['CheckerA'].stages['beforeCheck'];
        expect(stage.count).toBe(1);
    });

    it('start().end() 与 time() 等价', () => {
        const reporter = createPerfReporter(true);
        const h = reporter.start('CheckerA', 'check');
        h.end();
        expect(reporter.toJSON().checkers['CheckerA'].stages['check'].count).toBe(1);
    });

    it('totalMs 仅累加顶层阶段，不重复计入子阶段', () => {
        const reporter = createPerfReporter(true);
        reporter.record('CheckerA', 'collectMethods', 5_000_000n);
        reporter.record('CheckerA', 'collectMethods.computeHash', 2_000_000n);
        const checker = reporter.toJSON().checkers['CheckerA'];
        expect(checker.totalMs).toBeCloseTo(5.00, 2);
        expect(checker.stages['collectMethods.computeHash'].totalMs).toBeCloseTo(2.00, 2);
    });

    it('flush() 写出符合 schema 的 JSON', () => {
        const reporter = createPerfReporter(true);
        reporter.record('CheckerA', 'beforeCheck', 1_000_000n);
        const tmp = path.join(os.tmpdir(), `perf-enabled-${Date.now()}.json`);
        reporter.flush(tmp);

        const parsed = JSON.parse(fs.readFileSync(tmp, 'utf8')) as PerfReportShape;
        expect(parsed.perfEnabled).toBe(true);
        expect(parsed.checkers['CheckerA'].stages['beforeCheck'].count).toBe(1);
        expect(typeof parsed.runId).toBe('string');
        expect(typeof parsed.wallStartIso).toBe('string');
        expect(typeof parsed.wallEndIso).toBe('string');
        expect(parsed.totalWallMs).toBeGreaterThanOrEqual(0);

        fs.unlinkSync(tmp);
    });

    it('reset() 清空累计', () => {
        const reporter = createPerfReporter(true);
        reporter.record('CheckerA', 'beforeCheck', 1_000_000n);
        reporter.reset();
        expect(reporter.toJSON().checkers).toEqual({});
    });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx jest test/perf/PerfReporter.test.ts -v`
Expected: 全部 FAIL，错误是模块 `src/Checkers/perf/PerfReporter` 不存在。

- [ ] **Step 3: 不提交（等实现完成一起提交）**

---

### Task 3: PerfReporter 实现

**Files:**
- Create: `src/Checkers/perf/PerfReporter.ts`
- Create: `src/Checkers/perf/index.ts`

- [ ] **Step 1: 实现 PerfReporter**

```ts
// src/Checkers/perf/PerfReporter.ts
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
    PerfReportShape,
    StageHandle,
    StageRecord,
    StageRecordJson,
    CheckerReportJson
} from './types';

const NOOP_HANDLE: StageHandle = { end: () => {} };

function roundMs(ns: bigint): number {
    return Math.round(Number(ns) / 1e4) / 1e2; // ns -> 0.01ms 精度
}

export class PerfReporterImpl {
    public enabled: boolean;
    private data = new Map<string, Map<string, StageRecord>>();
    private wallStartNs: bigint;
    private wallStartIso: string;
    private exitHookRegistered = false;

    constructor(enabled: boolean) {
        this.enabled = enabled;
        this.wallStartNs = process.hrtime.bigint();
        this.wallStartIso = new Date().toISOString();
        if (enabled) {
            this.registerExitHook();
        }
    }

    private registerExitHook(): void {
        if (this.exitHookRegistered) {
            return;
        }
        this.exitHookRegistered = true;
        process.on('exit', () => {
            try {
                this.flush();
            } catch {
                // 退出钩子里吞掉所有异常，避免影响正常退出码
            }
        });
    }

    public start(checker: string, stage: string): StageHandle {
        if (!this.enabled) {
            return NOOP_HANDLE;
        }
        const t0 = process.hrtime.bigint();
        return {
            end: () => {
                this.record(checker, stage, process.hrtime.bigint() - t0);
            }
        };
    }

    public time<T>(checker: string, stage: string, fn: () => T): T {
        if (!this.enabled) {
            return fn();
        }
        const t0 = process.hrtime.bigint();
        try {
            return fn();
        } finally {
            this.record(checker, stage, process.hrtime.bigint() - t0);
        }
    }

    public record(checker: string, stage: string, ns: bigint, count: number = 1): void {
        if (!this.enabled) {
            return;
        }
        let stages = this.data.get(checker);
        if (!stages) {
            stages = new Map();
            this.data.set(checker, stages);
        }
        let rec = stages.get(stage);
        if (!rec) {
            rec = { count: 0, totalNs: 0n, minNs: ns, maxNs: ns };
            stages.set(stage, rec);
        }
        rec.count += count;
        rec.totalNs += ns;
        if (ns < rec.minNs) {
            rec.minNs = ns;
        }
        if (ns > rec.maxNs) {
            rec.maxNs = ns;
        }
    }

    public toJSON(): PerfReportShape {
        const wallEndNs = process.hrtime.bigint();
        const totalWallMs = roundMs(wallEndNs - this.wallStartNs);

        const checkers: Record<string, CheckerReportJson> = {};
        for (const [checker, stages] of this.data) {
            const stagesJson: Record<string, StageRecordJson> = {};
            let totalMs = 0;
            for (const [stage, rec] of stages) {
                const total = roundMs(rec.totalNs);
                const avg = rec.count > 0 ? Math.round((Number(rec.totalNs) / rec.count) / 1e4) / 1e2 : 0;
                const isSubStage = stage.includes('.');
                if (!isSubStage) {
                    totalMs += total;
                }
                stagesJson[stage] = {
                    count: rec.count,
                    totalMs: total,
                    avgMs: avg,
                    minMs: roundMs(rec.minNs),
                    maxMs: roundMs(rec.maxNs)
                };
            }
            checkers[checker] = { totalMs: Math.round(totalMs * 100) / 100, stages: stagesJson };
        }

        return {
            runId: this.wallStartIso,
            perfEnabled: this.enabled,
            wallStartIso: this.wallStartIso,
            wallEndIso: new Date().toISOString(),
            totalWallMs,
            checkers
        };
    }

    public flush(filePath?: string): void {
        if (!this.enabled) {
            return;
        }
        const target = filePath ?? path.resolve(process.cwd(), 'report/perfReport.json');
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.writeFileSync(target, JSON.stringify(this.toJSON(), null, 2));
    }

    public reset(): void {
        this.data.clear();
        this.wallStartNs = process.hrtime.bigint();
        this.wallStartIso = new Date().toISOString();
    }
}

export function createPerfReporter(
    enabled: boolean = process.env.EXTRULES_PERF === '1'
): PerfReporterImpl {
    return new PerfReporterImpl(enabled);
}

/** 进程单例：检测器代码统一从这里 import。 */
export const PerfReporter: PerfReporterImpl = createPerfReporter();
```

- [ ] **Step 2: 创建 index.ts**

```ts
// src/Checkers/perf/index.ts
export { PerfReporter, createPerfReporter, PerfReporterImpl } from './PerfReporter';
export type {
    StageHandle,
    StageRecord,
    StageRecordJson,
    CheckerReportJson,
    PerfReportShape
} from './types';
```

- [ ] **Step 3: 运行测试确认通过**

Run: `npx jest test/perf/PerfReporter.test.ts -v`
Expected: 13 tests PASS（disabled 4 + enabled 9）。

如有 1ms 精度抖动导致 `toBeCloseTo` 误差超容差，把容差从 `2` 改为 `1` 位小数；不要靠循环重试规避。

- [ ] **Step 4: 提交**

```bash
git add src/Checkers/perf/PerfReporter.ts src/Checkers/perf/index.ts test/perf/PerfReporter.test.ts
git commit -m "feat(perf): add PerfReporter singleton with hrtime-based stage aggregation"
```

---

### Task 4: 在 BaseRuleChecker.beforeCheck 集中埋点

**Files:**
- Modify: `src/Checkers/BaseRuleChecker.ts`

- [ ] **Step 1: 引入 PerfReporter 并包裹 beforeCheck**

把现有：

```ts
public beforeCheck(): void {
    this.issues = [];
    this._resolvedOptions = parseRuleOptions(this.rule, this.optionSchema, this.defaultOptions);
    this._optionsInitialized = true;
}
```

改为：

```ts
import { PerfReporter } from "./perf";

// ...类内部其余字段保持不变

public beforeCheck(): void {
    PerfReporter.time(this.constructor.name, 'beforeCheck', () => {
        this.issues = [];
        this._resolvedOptions = parseRuleOptions(this.rule, this.optionSchema, this.defaultOptions);
        this._optionsInitialized = true;
    });
}
```

- [ ] **Step 2: 编译**

Run: `npx tsc -p ./tsconfig.main.json --noEmit`
Expected: 0 errors。

- [ ] **Step 3: 跑现有套件确认无回归**

Run: `npx jest -v`
Expected: 现有所有测试通过；`PerfReporter.test.ts` 也仍通过。

- [ ] **Step 4: 提交**

```bash
git add src/Checkers/BaseRuleChecker.ts
git commit -m "feat(perf): instrument BaseRuleChecker.beforeCheck"
```

---

### Task 5: 包裹 4 个非克隆检测器的 `check`

**Files:**
- Modify: `src/Checkers/LongMethodCheck.ts`
- Modify: `src/Checkers/FeatureEnvyCheck.ts`
- Modify: `src/Checkers/SwitchStatementCheck.ts`
- Modify: `src/Checkers/ForEachArgsCheck.ts`

- [ ] **Step 1: LongMethodCheck.check**

在文件顶部 import：

```ts
import { PerfReporter } from "./perf";
```

把：

```ts
public check = (targetMtd: ArkMethod) => {
    const codeLineCount = this.countMethodCodeLines(targetMtd);
    if (isArkUiMethod(targetMtd)) {
        this.checkUIMethod(targetMtd, codeLineCount);
    } else {
        this.checkNormalMethod(targetMtd, codeLineCount);
    }
}
```

改为：

```ts
public check = (targetMtd: ArkMethod) => {
    PerfReporter.time(this.constructor.name, 'check', () => {
        const codeLineCount = this.countMethodCodeLines(targetMtd);
        if (isArkUiMethod(targetMtd)) {
            this.checkUIMethod(targetMtd, codeLineCount);
        } else {
            this.checkNormalMethod(targetMtd, codeLineCount);
        }
    });
}
```

- [ ] **Step 2: FeatureEnvyCheck.check / SwitchStatementCheck.check / ForEachArgsCheck.check**

对这三个文件做相同处理：在顶部 `import { PerfReporter } from "./perf";`，并把 `public check = (targetMtd: ArkMethod) => { <body> }` 改为 `public check = (targetMtd: ArkMethod) => { PerfReporter.time(this.constructor.name, 'check', () => { <body> }); }`。

注意每个 checker 的 body 不同，只搬动语句，不修改逻辑；如果 body 内有 `return`，把它放进 IIFE 不会破坏外层函数语义（外层 `check` 本身没有 return value）。

- [ ] **Step 3: 编译 + 现有测试**

Run: `npx tsc -p ./tsconfig.main.json --noEmit && npx jest -v`
Expected: 编译 0 errors；所有现有测试通过。

- [ ] **Step 4: 提交**

```bash
git add src/Checkers/LongMethodCheck.ts src/Checkers/FeatureEnvyCheck.ts src/Checkers/SwitchStatementCheck.ts src/Checkers/ForEachArgsCheck.ts
git commit -m "feat(perf): instrument check visitors of non-clone checkers"
```

---

### Task 6: 在 CodeCloneBaseCheck 包裹 collectMethods / afterCheck 及子阶段

**Files:**
- Modify: `src/Checkers/CodeCloneBaseCheck.ts`

- [ ] **Step 1: 顶部 import**

在文件 import 块末尾追加：

```ts
import { PerfReporter } from "./perf";
```

- [ ] **Step 2: 包裹 collectMethods（含 extractMethodInfo / computeHash 子阶段）**

把现有 `collectMethods`：

```ts
public collectMethods = (arkFile: ArkFile): void => {
    const filePath = arkFile.getFilePath();
    for (const arkClass of arkFile.getClasses()) {
        const className = arkClass.getName();
        if (shouldSkipClass(className)) { continue; }
        for (const method of arkClass.getMethods()) {
            if (shouldSkipMethod(method.getName())) { continue; }
            const methodInfo = this.extractMethodInfo(method, filePath, className);
            if (!methodInfo || methodInfo.stmtCount < this.option("minStmts")) { continue; }
            const methodKey = this.getMethodIdentityKey(methodInfo);
            if (this.collectedMethodKeys.has(methodKey)) { continue; }
            this.collectedMethodKeys.add(methodKey);
            this.addMethodToHash(methodInfo);
        }
    }
}
```

改为：

```ts
public collectMethods = (arkFile: ArkFile): void => {
    PerfReporter.time(this.constructor.name, 'collectMethods', () => {
        const filePath = arkFile.getFilePath();
        for (const arkClass of arkFile.getClasses()) {
            const className = arkClass.getName();
            if (shouldSkipClass(className)) { continue; }
            for (const method of arkClass.getMethods()) {
                if (shouldSkipMethod(method.getName())) { continue; }
                const methodInfo = PerfReporter.time(
                    this.constructor.name,
                    'collectMethods.extractMethodInfo',
                    () => this.extractMethodInfo(method, filePath, className)
                );
                if (!methodInfo || methodInfo.stmtCount < this.option("minStmts")) { continue; }
                const methodKey = this.getMethodIdentityKey(methodInfo);
                if (this.collectedMethodKeys.has(methodKey)) { continue; }
                this.collectedMethodKeys.add(methodKey);
                this.addMethodToHash(methodInfo);
            }
        }
    });
}
```

并在 `extractMethodInfo` 内部把对 `this.computeHash(stmts)` 的调用：

```ts
const { hash, normalizedContent } = this.computeHash(stmts);
```

改为：

```ts
const { hash, normalizedContent } = PerfReporter.time(
    this.constructor.name,
    'collectMethods.computeHash',
    () => this.computeHash(stmts)
);
```

- [ ] **Step 3: 包裹 afterCheck 及其内部子阶段**

把现有 `afterCheck`：

```ts
public afterCheck(): void {
    this.findClonePairs();
    const threshold = this.option("similarityThreshold");
    if (threshold < 1.0) {
        this.findNearMissClones(threshold);
    }
    if (this.option("enableCloneClasses") && this.collectedPairs.length > 0) {
        this.issues = [];
        this.reportCloneClasses();
    }
}
```

改为：

```ts
public afterCheck(): void {
    PerfReporter.time(this.constructor.name, 'afterCheck', () => {
        PerfReporter.time(this.constructor.name, 'afterCheck.findClonePairs', () => this.findClonePairs());

        const threshold = this.option("similarityThreshold");
        if (threshold < 1.0) {
            PerfReporter.time(
                this.constructor.name,
                'afterCheck.findNearMissClones',
                () => this.findNearMissClones(threshold)
            );
        }

        if (this.option("enableCloneClasses") && this.collectedPairs.length > 0) {
            this.issues = [];
            PerfReporter.time(
                this.constructor.name,
                'afterCheck.reportCloneClasses',
                () => this.reportCloneClasses()
            );
        }
    });
}
```

- [ ] **Step 4: 编译 + 跑现有套件**

Run: `npx tsc -p ./tsconfig.main.json --noEmit && npx jest -v`
Expected: 编译 0 errors；所有现有测试通过。

- [ ] **Step 5: 提交**

```bash
git add src/Checkers/CodeCloneBaseCheck.ts
git commit -m "feat(perf): instrument CodeCloneBaseCheck collect/after stages"
```

---

### Task 7: 在 CodeCloneFragmentCheck 包裹 collectTokens / afterCheck 及子阶段

**Files:**
- Modify: `src/Checkers/CodeCloneFragmentCheck.ts`

- [ ] **Step 1: 顶部 import**

```ts
import { PerfReporter } from "./perf";
```

- [ ] **Step 2: 包裹 collectTokens 及其内部 readSourceFile / removeLogLines / tokenize / processFile**

把现有 `collectTokens`：

```ts
public collectTokens = (arkFile: ArkFile): void => {
    const filePath = arkFile.getFilePath();
    const readResult = readSourceFile(filePath);
    let sourceCode = readResult.content;

    if (sourceCode === null) {
        this.diagnostics.filesReadFailed++;
        this.diagnostics.errors.push({
            filePath,
            phase: "read",
            message: readResult.errorMessage ?? "failed to read source file"
        });
        return;
    }

    this.fileCache.set(filePath, arkFile);

    if (this.options.ignoreLogs) {
        sourceCode = removeLogLines(sourceCode, arkFile);
    }

    try {
        const tokens = this.tokenizer.tokenize(sourceCode, filePath);
        if (tokens.length < this.options.minimumTokens) { return; }
        const minDistinctTokenTypes = this.options.minDistinctTokenTypes;
        if (minDistinctTokenTypes > 0) {
            const distinctTypes = new Set(tokens.map(token => token.type)).size;
            if (distinctTypes < minDistinctTokenTypes) { return; }
        }
        this.cloneMatcher.processFile(tokens, filePath);
        this.fileTokenCache.set(filePath, tokens);
    } catch (error) {
        this.diagnostics.filesProcessFailed++;
        this.diagnostics.errors.push({
            filePath,
            phase: "process",
            message: error instanceof Error ? error.message : "failed to process file"
        });
    }
}
```

改为：

```ts
public collectTokens = (arkFile: ArkFile): void => {
    const checkerName = this.constructor.name;
    PerfReporter.time(checkerName, 'collectTokens', () => {
        const filePath = arkFile.getFilePath();
        const readResult = PerfReporter.time(
            checkerName,
            'collectTokens.readSourceFile',
            () => readSourceFile(filePath)
        );
        let sourceCode = readResult.content;

        if (sourceCode === null) {
            this.diagnostics.filesReadFailed++;
            this.diagnostics.errors.push({
                filePath,
                phase: "read",
                message: readResult.errorMessage ?? "failed to read source file"
            });
            return;
        }

        this.fileCache.set(filePath, arkFile);

        if (this.options.ignoreLogs) {
            sourceCode = PerfReporter.time(
                checkerName,
                'collectTokens.removeLogLines',
                () => removeLogLines(sourceCode as string, arkFile)
            );
        }

        try {
            const tokens = PerfReporter.time(
                checkerName,
                'collectTokens.tokenize',
                () => this.tokenizer.tokenize(sourceCode as string, filePath)
            );
            if (tokens.length < this.options.minimumTokens) { return; }
            const minDistinctTokenTypes = this.options.minDistinctTokenTypes;
            if (minDistinctTokenTypes > 0) {
                const distinctTypes = new Set(tokens.map(token => token.type)).size;
                if (distinctTypes < minDistinctTokenTypes) { return; }
            }
            PerfReporter.time(
                checkerName,
                'collectTokens.processFile',
                () => this.cloneMatcher.processFile(tokens, filePath)
            );
            this.fileTokenCache.set(filePath, tokens);
        } catch (error) {
            this.diagnostics.filesProcessFailed++;
            this.diagnostics.errors.push({
                filePath,
                phase: "process",
                message: error instanceof Error ? error.message : "failed to process file"
            });
        }
    });
}
```

注意：原代码里 `sourceCode` 是 `let` 且会被 `removeLogLines` 重新赋值；闭包内 TS 推断变窄会要求 `as string` 兜底。如果编译报 `string | null`，按上面例子使用 `sourceCode as string`。

- [ ] **Step 3: 包裹 afterCheck 及内部 getClonePairs / merge / dedup / findNearMissClones / reportGen**

把现有 `afterCheck`：

```ts
public afterCheck(): void {
    const clonePairs = this.cloneMatcher.getClonePairs();
    const merged = clonePairs.length > 0 ? this.cloneMerger.merge(clonePairs) : [];
    const exactClones = deduplicateMergedClones(filterSelfOverlappingClones(merged));

    const threshold = this.options.similarityThreshold;
    const nearMissClones = threshold < 1.0 ? this.findNearMissClones(threshold) : [];

    if (exactClones.length === 0 && nearMissClones.length === 0) { return; }

    if (this.options.enableCloneClasses) {
        const classReports = this.createCloneClassReports(exactClones);
        for (const report of classReports) {
            this.addCloneClassIssueReport(report);
        }
        return;
    }

    for (const clone of exactClones) {
        this.addIssueReport(this.createCloneReport(clone));
    }
    for (const clone of nearMissClones) {
        this.addIssueReport(this.createNearMissReport(clone));
    }
}
```

改为：

```ts
public afterCheck(): void {
    const checkerName = this.constructor.name;
    PerfReporter.time(checkerName, 'afterCheck', () => {
        const clonePairs = PerfReporter.time(
            checkerName,
            'afterCheck.getClonePairs',
            () => this.cloneMatcher.getClonePairs()
        );

        const merged = clonePairs.length > 0
            ? PerfReporter.time(
                checkerName,
                'afterCheck.merge',
                () => this.cloneMerger.merge(clonePairs)
            )
            : [];

        const exactClones = PerfReporter.time(
            checkerName,
            'afterCheck.dedup',
            () => deduplicateMergedClones(filterSelfOverlappingClones(merged))
        );

        const threshold = this.options.similarityThreshold;
        const nearMissClones = threshold < 1.0
            ? PerfReporter.time(
                checkerName,
                'afterCheck.findNearMissClones',
                () => this.findNearMissClones(threshold)
            )
            : [];

        if (exactClones.length === 0 && nearMissClones.length === 0) { return; }

        PerfReporter.time(checkerName, 'afterCheck.reportGen', () => {
            if (this.options.enableCloneClasses) {
                const classReports = this.createCloneClassReports(exactClones);
                for (const report of classReports) {
                    this.addCloneClassIssueReport(report);
                }
                return;
            }
            for (const clone of exactClones) {
                this.addIssueReport(this.createCloneReport(clone));
            }
            for (const clone of nearMissClones) {
                this.addIssueReport(this.createNearMissReport(clone));
            }
        });
    });
}
```

- [ ] **Step 4: 编译 + 现有套件**

Run: `npx tsc -p ./tsconfig.main.json --noEmit && npx jest -v`
Expected: 编译 0 errors；所有现有测试通过。

- [ ] **Step 5: 提交**

```bash
git add src/Checkers/CodeCloneFragmentCheck.ts
git commit -m "feat(perf): instrument CodeCloneFragmentCheck collect/after stages"
```

---

### Task 8: 端到端冒烟测试

**Files:**
- Create: `test/perf/PerfReporterIntegration.test.ts`

- [ ] **Step 1: 写测试**

```ts
// test/perf/PerfReporterIntegration.test.ts
import * as path from 'path';
import * as fs from 'node:fs';
import * as os from 'node:os';
import { Scene, SceneConfig } from 'arkanalyzer';
import { Rule } from 'homecheck';
import { ALERT_LEVEL } from 'homecheck/lib/model/Rule';
import { LongMethodCheck } from '../../src/Checkers/LongMethodCheck';
import { PerfReporter } from '../../src/Checkers/perf/PerfReporter';
import { PerfReportShape } from '../../src/Checkers/perf/types';

const PROJECT_DIR = path.resolve(__dirname, '..', 'sample/LongMethod');

describe('perf integration (LongMethodCheck)', () => {
    const previousEnabled = PerfReporter.enabled;

    beforeEach(() => {
        PerfReporter.enabled = true;   // 在测试中强制开启模块级单例
        PerfReporter.reset();
    });

    afterEach(() => {
        PerfReporter.reset();
        PerfReporter.enabled = previousEnabled;
    });

    it('开启时输出可解析的 perfReport.json，包含 LongMethodCheck.check', () => {
        const sceneConfig = new SceneConfig();
        sceneConfig.buildFromProjectDir(PROJECT_DIR);
        const scene = new Scene();
        scene.buildSceneFromProjectDir(sceneConfig);

        const checker = new LongMethodCheck();
        checker.rule = {
            ruleId: '@extrulesproject/long-method-check',
            alert: ALERT_LEVEL.WARN
        } as unknown as Rule;

        checker.beforeCheck();
        for (const arkFile of scene.getFiles()) {
            for (const arkClass of arkFile.getClasses()) {
                for (const method of arkClass.getMethods()) {
                    checker.check(method);
                }
            }
        }

        const tmp = path.join(os.tmpdir(), `perfReport-test-${Date.now()}.json`);
        PerfReporter.flush(tmp);

        const parsed = JSON.parse(fs.readFileSync(tmp, 'utf8')) as PerfReportShape;
        expect(parsed.perfEnabled).toBe(true);
        expect(parsed.checkers['LongMethodCheck']).toBeDefined();
        const stages = parsed.checkers['LongMethodCheck'].stages;
        expect(stages['beforeCheck']).toBeDefined();
        expect(stages['check']).toBeDefined();
        expect(stages['check'].count).toBeGreaterThan(0);

        fs.unlinkSync(tmp);
    });

    it('关闭时 flush() 不写文件', () => {
        PerfReporter.enabled = false;
        const tmp = path.join(os.tmpdir(), `perfReport-disabled-${Date.now()}.json`);
        PerfReporter.flush(tmp);
        expect(fs.existsSync(tmp)).toBe(false);
    });
});
```

- [ ] **Step 2: 运行**

Run: `npx jest test/perf/PerfReporterIntegration.test.ts -v`
Expected: PASS。

如果失败原因是 `scene.getFiles()` 接口名不同，先查 `test/LongMethodCheck.integration.test.ts` 看现有调用方式，对齐 API 后再跑。

- [ ] **Step 3: 跑全量测试确认无回归**

Run: `npx jest -v`
Expected: 所有测试通过。

- [ ] **Step 4: 提交**

```bash
git add test/perf/PerfReporterIntegration.test.ts
git commit -m "test(perf): add end-to-end smoke test for perf instrumentation"
```

---

## Final Verification

- [ ] **运行全量测试**

Run: `npm test`
Expected: 所有测试通过，包含 PerfReporter 单元 + 集成。

- [ ] **手动验证 perfReport.json 产物**（须用直接 Node 调用，不是 Jest）

> 备注：Jest 在测试结束时会强制终止 worker，**不会**触发用户注册的 `'exit'`/`'beforeExit'` 监听器。因此 PerfReporter 的 exit-hook 自动 flush 在 Jest 内观察不到。生产路径（`node ./node_modules/homecheck/lib/run.js ...` 或任何直接 Node 调用）退出时会正常触发并写文件。Task 8 的集成测试通过显式 `PerfReporter.flush(tmp)` 验证 schema，不依赖 exit-hook。

Run:

```bash
rm -f report/perfReport.json
npx tsc -p ./tsconfig.prod.json
EXTRULES_PERF=1 node -e "
const { PerfReporter } = require('./lib/Checkers/perf/PerfReporter');
PerfReporter.record('SmokeCheck', 'beforeCheck', BigInt(1500000));
PerfReporter.record('SmokeCheck', 'check', BigInt(3000000));
PerfReporter.record('SmokeCheck', 'check', BigInt(5000000));
"
ls -l report/perfReport.json
```

Expected: `report/perfReport.json` 存在，`checkers.SmokeCheck.stages.{beforeCheck,check}` 字段齐全且 `check.count === 2`。

- [ ] **手动验证关闭时无产物**

Run:

```bash
rm -f report/perfReport.json
unset EXTRULES_PERF
node -e "
const { PerfReporter } = require('./lib/Checkers/perf/PerfReporter');
PerfReporter.record('SmokeCheck', 'beforeCheck', BigInt(1500000));
PerfReporter.flush();
"
test ! -f report/perfReport.json && echo OK
```

Expected: 输出 `OK`（关闭时 `flush()` 是 no-op，且未注册 exit hook）。
