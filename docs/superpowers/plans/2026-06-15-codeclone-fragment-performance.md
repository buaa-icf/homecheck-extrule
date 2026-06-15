# CodeCloneFragment Performance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the exact fragment-clone path's pair-first expansion with a clone-class-first path that preserves semantic clone reporting while avoiding quadratic candidate growth on high-repeat code.

**Architecture:** `CloneMatcher` will expose duplicate exact windows as `ExactCloneGroup[]` without expanding all pair combinations. A new `ExactCloneClassBuilder` will collapse each group into stable reportable clone classes and representative pair clones. `CodeCloneFragmentCheck.afterCheck` will use this new path for exact clones while keeping the old pair pipeline available for compatibility tests and future fallback.

**Tech Stack:** TypeScript, Jest, existing `PerfReporter`, existing `FragmentDetection` modules.

---

## File Structure

- Modify `src/Checkers/FragmentDetection/CloneMatcher.ts`
  - Add `ExactCloneGroup`.
  - Add `getExactCloneGroups()` that reuses hash duplicates and fingerprint verification.
- Create `src/Checkers/FragmentDetection/ExactCloneClassBuilder.ts`
  - Convert `ExactCloneGroup[]` to `MergedCloneClass[]`.
  - Convert class representatives to `MergedClone[]` for pair-style reports.
- Modify `src/Checkers/FragmentDetection/index.ts`
  - Export new class-first types and builder.
- Modify `src/Checkers/CodeCloneFragmentCheck.ts`
  - Replace exact clone `getClonePairs -> merge -> dedup` path with `getExactCloneGroups -> buildExactCloneClasses`.
  - Keep Type-3 path unchanged for this iteration.
- Modify `test/FragmentDetection.test.ts`
  - Add group API and class builder unit tests.
- Modify `test/RuleOutputRegression.test.ts`
  - Add semantic assertions if pair count changes under the new path.
- Modify `README.md` and `docs/code-clone-fragment-check.md`
  - Document that exact clone detection uses class-first grouping internally.

---

### Task 1: Add Exact Clone Group API

**Files:**
- Modify: `src/Checkers/FragmentDetection/CloneMatcher.ts`
- Modify: `src/Checkers/FragmentDetection/index.ts`
- Test: `test/FragmentDetection.test.ts`

- [ ] **Step 1: Write failing tests for exact clone groups**

Add these tests inside the existing `describe('克隆匹配器', () => { ... })` block in `test/FragmentDetection.test.ts`:

```ts
test('getExactCloneGroups 应按指纹聚合重复窗口而不是展开所有 pair', () => {
    const matcher = new CloneMatcher(4);
    const repeatedA = mockTokens(['a', 'b', 'c', 'd'], 1);
    const repeatedB = mockTokens(['a', 'b', 'c', 'd'], 10);
    const repeatedC = mockTokens(['a', 'b', 'c', 'd'], 20);

    matcher.processFile(repeatedA, 'a.ts');
    matcher.processFile(repeatedB, 'b.ts');
    matcher.processFile(repeatedC, 'c.ts');

    const groups = matcher.getExactCloneGroups();

    expect(groups).toHaveLength(1);
    expect(groups[0].tokenCount).toBe(4);
    expect(groups[0].locations.map(location => location.file)).toEqual(['a.ts', 'b.ts', 'c.ts']);
});

test('getExactCloneGroups 应跳过哈希碰撞后指纹不同的位置', () => {
    const matcher = new CloneMatcher(4);
    matcher.processFile(mockTokens(['a', 'b', 'c', 'd'], 1), 'a.ts');
    matcher.processFile(mockTokens(['a', 'b', 'c', 'e'], 10), 'b.ts');

    const groups = matcher.getExactCloneGroups();

    expect(groups).toHaveLength(0);
});
```

- [ ] **Step 2: Run tests to verify RED**

Run:

```bash
npm test -- --runInBand test/FragmentDetection.test.ts
```

Expected: FAIL with TypeScript/Jest error that `getExactCloneGroups` does not exist on `CloneMatcher`.

- [ ] **Step 3: Add the API and implementation**

In `src/Checkers/FragmentDetection/CloneMatcher.ts`, add this interface after `ClonePair`:

```ts
export interface ExactCloneGroup {
    fingerprint: string;
    locations: FragmentLocation[];
    tokenCount: number;
}
```

Add this method to `CloneMatcher`, immediately before `getClonePairs()`:

```ts
getExactCloneGroups(): ExactCloneGroup[] {
    const groups: ExactCloneGroup[] = [];
    for (const match of this.getMatches()) {
        const fingerprintGroups = groupBy(match.locations, loc => this.resolveFingerprint(loc));
        for (const [fingerprint, group] of fingerprintGroups) {
            if (fingerprint === '' || group.length < 2) {
                continue;
            }
            groups.push({
                fingerprint,
                locations: sortFragmentLocations(group),
                tokenCount: this.windowSize
            });
        }
    }
    return groups;
}
```

In `src/Checkers/FragmentDetection/index.ts`, change the clone matcher export to:

```ts
export { CloneMatch, ClonePair, ExactCloneGroup, CloneMatcher, CloneMatcherOptions } from './CloneMatcher';
```

- [ ] **Step 4: Run tests to verify GREEN**

Run:

```bash
npm test -- --runInBand test/FragmentDetection.test.ts
```

Expected: PASS for the fragment detection suite.

---

### Task 2: Add ExactCloneClassBuilder

**Files:**
- Create: `src/Checkers/FragmentDetection/ExactCloneClassBuilder.ts`
- Modify: `src/Checkers/FragmentDetection/index.ts`
- Test: `test/FragmentDetection.test.ts`

- [ ] **Step 1: Write failing tests for class-first grouping**

Add imports in `test/FragmentDetection.test.ts`:

```ts
ExactCloneClassBuilder,
ExactCloneGroup,
MergedCloneClass
```

Add this test block near the `CloneClassifier` tests:

```ts
describe('ExactCloneClassBuilder', () => {
    function makeLocation(file: string, startIndex: number, startLine: number = startIndex + 1) {
        return {
            file,
            startIndex,
            startLine,
            endLine: startLine + 3,
            tokenFingerprint: 'a|b|c|d'
        };
    }

    function makeGroup(locations: ReturnType<typeof makeLocation>[]): ExactCloneGroup {
        return {
            fingerprint: 'a|b|c|d',
            locations,
            tokenCount: 4
        };
    }

    test('build 应把一个重复指纹组转换为一个稳定排序的 clone class', () => {
        const builder = new ExactCloneClassBuilder();
        const classes = builder.build([
            makeGroup([
                makeLocation('c.ts', 0, 30),
                makeLocation('a.ts', 0, 10),
                makeLocation('b.ts', 0, 20)
            ])
        ]);

        expect(classes).toHaveLength(1);
        expect(classes[0].classId).toBe(1);
        expect(classes[0].members.map(member => member.file)).toEqual(['a.ts', 'b.ts', 'c.ts']);
        expect(classes[0].tokenCount).toBe(4);
    });

    test('build 应过滤同文件重叠成员但保留同文件非重叠成员', () => {
        const builder = new ExactCloneClassBuilder();
        const classes = builder.build([
            makeGroup([
                makeLocation('a.ts', 0, 1),
                makeLocation('a.ts', 1, 2),
                makeLocation('a.ts', 10, 20)
            ])
        ]);

        expect(classes).toHaveLength(1);
        expect(classes[0].members.map(member => member.startIndex)).toEqual([0, 10]);
    });

    test('toRepresentativeClones 应从 clone class 派生稳定 pair 报告输入', () => {
        const builder = new ExactCloneClassBuilder();
        const classes = builder.build([
            makeGroup([
                makeLocation('a.ts', 0, 10),
                makeLocation('b.ts', 0, 20),
                makeLocation('c.ts', 0, 30)
            ])
        ]);

        const clones = builder.toRepresentativeClones(classes);

        expect(clones).toHaveLength(1);
        expect(clones[0].location1.file).toBe('a.ts');
        expect(clones[0].location2.file).toBe('b.ts');
        expect(clones[0].tokenCount).toBe(4);
    });
});
```

- [ ] **Step 2: Run tests to verify RED**

Run:

```bash
npm test -- --runInBand test/FragmentDetection.test.ts
```

Expected: FAIL with missing `ExactCloneClassBuilder` / `ExactCloneGroup` exports.

- [ ] **Step 3: Implement builder**

Create `src/Checkers/FragmentDetection/ExactCloneClassBuilder.ts` with:

```ts
import { ExactCloneGroup } from './CloneMatcher';
import { MergedClone } from './CloneMerger';
import { FragmentLocation } from './HashIndex';

export interface MergedCloneMember {
    file: string;
    startLine: number;
    endLine: number;
    startIndex: number;
    endIndex: number;
}

export interface MergedCloneClass {
    classId: number;
    members: MergedCloneMember[];
    tokenCount: number;
}

export class ExactCloneClassBuilder {
    build(groups: ExactCloneGroup[]): MergedCloneClass[] {
        const classes: MergedCloneClass[] = [];
        for (const group of groups) {
            const members = this.selectMembers(group);
            if (members.length < 2) {
                continue;
            }
            classes.push({
                classId: classes.length + 1,
                members,
                tokenCount: group.tokenCount
            });
        }
        return classes;
    }

    toRepresentativeClones(classes: MergedCloneClass[]): MergedClone[] {
        const clones: MergedClone[] = [];
        for (const cloneClass of classes) {
            const first = cloneClass.members[0];
            const second = cloneClass.members[1];
            if (first === undefined || second === undefined) {
                continue;
            }
            clones.push({
                location1: { ...first },
                location2: { ...second },
                tokenCount: cloneClass.tokenCount
            });
        }
        return clones;
    }

    private selectMembers(group: ExactCloneGroup): MergedCloneMember[] {
        const selected: MergedCloneMember[] = [];
        for (const location of [...group.locations].sort(compareLocation)) {
            const member = toMember(location, group.tokenCount);
            if (selected.some(existing => overlapsSameFile(existing, member))) {
                continue;
            }
            selected.push(member);
        }
        return selected;
    }
}

function toMember(location: FragmentLocation, tokenCount: number): MergedCloneMember {
    return {
        file: location.file,
        startLine: location.startLine,
        endLine: location.endLine,
        startIndex: location.startIndex,
        endIndex: location.startIndex + tokenCount - 1
    };
}

function overlapsSameFile(a: MergedCloneMember, b: MergedCloneMember): boolean {
    return a.file === b.file && Math.max(a.startIndex, b.startIndex) <= Math.min(a.endIndex, b.endIndex);
}

function compareLocation(a: FragmentLocation, b: FragmentLocation): number {
    if (a.file !== b.file) {
        return a.file.localeCompare(b.file);
    }
    if (a.startIndex !== b.startIndex) {
        return a.startIndex - b.startIndex;
    }
    return a.startLine - b.startLine;
}
```

In `src/Checkers/FragmentDetection/index.ts`, export it:

```ts
export {
    ExactCloneClassBuilder,
    MergedCloneClass,
    MergedCloneMember
} from './ExactCloneClassBuilder';
```

- [ ] **Step 4: Run tests to verify GREEN**

Run:

```bash
npm test -- --runInBand test/FragmentDetection.test.ts
```

Expected: PASS for the fragment detection suite.

---

### Task 3: Integrate Class-First Exact Path into CodeCloneFragmentCheck

**Files:**
- Modify: `src/Checkers/CodeCloneFragmentCheck.ts`
- Test: `test/RuleOutputRegression.test.ts`
- Test: `test/FragmentDetection.test.ts`

- [ ] **Step 1: Write failing integration assertion for class-first default pair report**

In `test/RuleOutputRegression.test.ts`, add an assertion after collecting `fragment.issues` in the `CodeCloneFragmentCheck 输出应稳定` test:

```ts
expect(fragment.issues.some(issue =>
    issue.description.includes('Code Clone') &&
    issue.description.includes('similar to')
)).toBe(true);
```

In `test/FragmentDetection.test.ts`, add a unit test that demonstrates representative clones can feed the existing `deduplicateMergedClones` function:

```ts
test('ExactCloneClassBuilder representative clones 可被现有 dedup 处理', () => {
    const builder = new ExactCloneClassBuilder();
    const classes: MergedCloneClass[] = [{
        classId: 1,
        tokenCount: 4,
        members: [
            { file: 'a.ts', startLine: 1, endLine: 4, startIndex: 0, endIndex: 3 },
            { file: 'b.ts', startLine: 1, endLine: 4, startIndex: 0, endIndex: 3 },
            { file: 'c.ts', startLine: 1, endLine: 4, startIndex: 0, endIndex: 3 }
        ]
    }];

    const clones = deduplicateMergedClones(builder.toRepresentativeClones(classes));

    expect(clones).toHaveLength(1);
    expect(clones[0].location1.file).toBe('a.ts');
    expect(clones[0].location2.file).toBe('b.ts');
});
```

- [ ] **Step 2: Run tests to verify RED or current behavior gap**

Run:

```bash
npm test -- --runInBand test/RuleOutputRegression.test.ts test/FragmentDetection.test.ts
```

Expected before implementation: fragment tests pass after Task 2; rule regression still uses old exact path and therefore does not cover class-first stages.

- [ ] **Step 3: Change imports and constructor state**

In `src/Checkers/CodeCloneFragmentCheck.ts`, add imports:

```ts
ExactCloneClassBuilder,
MergedCloneClass,
MergedCloneMember,
```

Add a private field:

```ts
private exactCloneClassBuilder: ExactCloneClassBuilder = new ExactCloneClassBuilder();
```

- [ ] **Step 4: Replace exact clone work in afterCheck**

Replace the exact clone block in `afterCheck()` with:

```ts
const exactGroups = PerfReporter.time(
    checkerName,
    'afterCheck.getExactCloneGroups',
    () => this.cloneMatcher.getExactCloneGroups()
);

const exactCloneClasses = exactGroups.length > 0
    ? PerfReporter.time(
        checkerName,
        'afterCheck.buildExactCloneClasses',
        () => this.exactCloneClassBuilder.build(exactGroups)
    )
    : [];

const exactClones = PerfReporter.time(
    checkerName,
    'afterCheck.dedup',
    () => deduplicateMergedClones(
        filterSelfOverlappingClones(
            this.exactCloneClassBuilder.toRepresentativeClones(exactCloneClasses)
        )
    )
);
```

Remove the now-unused local `clonePairs` and `merged` variables from the exact path. Keep `CloneMerger` construction and old `getClonePairs()` API for tests and fallback compatibility in this iteration.

- [ ] **Step 5: Use clone classes directly when requested**

In the `reportGen` block, replace:

```ts
const classReports = this.createCloneClassReports(exactClones);
```

with:

```ts
const classReports = this.createCloneClassReportsFromMergedClasses(exactCloneClasses);
```

Add this private method near `createCloneClassReports`:

```ts
private createCloneClassReportsFromMergedClasses(classes: MergedCloneClass[]): FragmentCloneClassReport[] {
    const reports: FragmentCloneClassReport[] = [];
    for (const cloneClass of classes) {
        const members = cloneClass.members.map(member => this.resolveCodeLocation(
            member.file,
            member.startLine,
            member.endLine
        ));
        if (members.length < 2) {
            continue;
        }
        reports.push({
            cloneType: detectCloneType(this.options),
            scope: determineClassScope(members),
            classId: cloneClass.classId,
            members
        });
    }
    return reports;
}
```

- [ ] **Step 6: Run focused tests**

Run:

```bash
npm test -- --runInBand test/RuleOutputRegression.test.ts test/FragmentDetection.test.ts
```

Expected: PASS. If snapshots change only in clone count/order, inspect the output and update semantic assertions before updating snapshots.

---

### Task 4: Add High-Repeat Performance Guard

**Files:**
- Modify: `test/FragmentDetection.test.ts`

- [ ] **Step 1: Write performance-shape test**

Add this test inside `describe('ExactCloneClassBuilder', () => { ... })`:

```ts
test('高重复 group 构建结果随位置数线性增长且不展开 pair', () => {
    const builder = new ExactCloneClassBuilder();
    const locations = Array.from({ length: 1000 }, (_, index) => ({
        file: `file-${index}.ts`,
        startIndex: 0,
        startLine: 1,
        endLine: 4,
        tokenFingerprint: 'a|b|c|d'
    }));
    const groups: ExactCloneGroup[] = [{
        fingerprint: 'a|b|c|d',
        locations,
        tokenCount: 4
    }];

    const classes = builder.build(groups);
    const representative = builder.toRepresentativeClones(classes);

    expect(classes).toHaveLength(1);
    expect(classes[0].members).toHaveLength(1000);
    expect(representative).toHaveLength(1);
});
```

- [ ] **Step 2: Run focused test**

Run:

```bash
npm test -- --runInBand test/FragmentDetection.test.ts
```

Expected: PASS.

---

### Task 5: Documentation and Verification

**Files:**
- Modify: `README.md`
- Modify: `docs/code-clone-fragment-check.md`

- [ ] **Step 1: Update docs**

In both docs, update the `maxPairsPerFingerprint` explanation to:

```md
`maxPairsPerFingerprint` is retained for compatibility and fallback pair expansion. The exact clone path groups duplicate token windows into clone classes before generating pair-style reports, so high-frequency fingerprints no longer require enumerating every candidate pair.
```

- [ ] **Step 2: Run build**

Run:

```bash
npm run build
```

Expected: TypeScript build exits 0.

- [ ] **Step 3: Run full tests**

Run:

```bash
npm test -- --runInBand
```

Expected: all test suites pass. Existing `MaxListenersExceededWarning` may still appear; it is not introduced by this plan and is not a failure unless Jest exits non-zero.

- [ ] **Step 4: Run local microbenchmark**

Run:

```bash
node -e '
const { CloneMatcher, ExactCloneClassBuilder, createToken, TokenType } = require("./lib/Checkers/FragmentDetection");
function tokens(file) {
  return ["a","b","c","d"].map((value, index) => createToken(value, TokenType.IDENTIFIER, index + 1, 0, file));
}
const matcher = new CloneMatcher(4);
for (let i = 0; i < 1000; i++) matcher.processFile(tokens(`file-${i}.ts`), `file-${i}.ts`);
const builder = new ExactCloneClassBuilder();
const t0 = process.hrtime.bigint();
const groups = matcher.getExactCloneGroups();
const classes = builder.build(groups);
const reps = builder.toRepresentativeClones(classes);
const t1 = process.hrtime.bigint();
console.log(JSON.stringify({ groups: groups.length, classes: classes.length, representativePairs: reps.length, ms: Number(t1 - t0) / 1e6 }));
'
```

Expected: `groups=1`, `classes=1`, `representativePairs=1`, and elapsed time should be small enough to run interactively.

---

## Self-Review

Spec coverage:

- Pair explosion eliminated by Tasks 1-3.
- Semantic compatibility guarded by Tasks 2-4 and existing regression tests.
- Performance evidence covered by Task 4 and Task 5 microbenchmark.
- Documentation covered by Task 5.
- Type-3 near-miss optimization intentionally deferred by the design non-goals and delivery order.

Placeholder scan:

- No task contains TBD/TODO/fill-in placeholders.

Type consistency:

- `ExactCloneGroup`, `MergedCloneClass`, and `MergedCloneMember` are defined before first use.
- `ExactCloneClassBuilder.toRepresentativeClones()` returns existing `MergedClone[]` so `buildFragmentCloneReport` and `deduplicateMergedClones` stay compatible.
