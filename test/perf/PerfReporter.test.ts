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
        reporter.record('CheckerA', 'beforeCheck', BigInt(1_000_000));
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
    const created: Array<{ dispose(): void }> = [];

    function make(): ReturnType<typeof createPerfReporter> {
        const r = createPerfReporter(true);
        created.push(r);
        return r;
    }

    afterEach(() => {
        while (created.length > 0) {
            created.pop()!.dispose();
        }
    });

    it('record() 累加 count/total 并更新 min/max', () => {
        const reporter = make();
        reporter.record('CheckerA', 'check', BigInt(1_000_000)); // 1ms
        reporter.record('CheckerA', 'check', BigInt(3_000_000)); // 3ms
        reporter.record('CheckerA', 'check', BigInt(2_000_000)); // 2ms

        const json = reporter.toJSON();
        const stage = json.checkers['CheckerA'].stages['check'];
        expect(stage.count).toBe(3);
        expect(stage.totalMs).toBeCloseTo(6.00, 2);
        expect(stage.avgMs).toBeCloseTo(2.00, 2);
        expect(stage.minMs).toBeCloseTo(1.00, 2);
        expect(stage.maxMs).toBeCloseTo(3.00, 2);
    });

    it('time(fn) 返回 fn 结果并记录耗时', () => {
        const reporter = make();
        const result = reporter.time('CheckerA', 'beforeCheck', () => 'ok');
        expect(result).toBe('ok');
        const stage = reporter.toJSON().checkers['CheckerA'].stages['beforeCheck'];
        expect(stage.count).toBe(1);
        expect(stage.totalMs).toBeGreaterThanOrEqual(0);
    });

    it('time(fn) 抛异常时仍记录耗时', () => {
        const reporter = make();
        expect(() => reporter.time('CheckerA', 'beforeCheck', () => {
            throw new Error('boom');
        })).toThrow('boom');
        const stage = reporter.toJSON().checkers['CheckerA'].stages['beforeCheck'];
        expect(stage.count).toBe(1);
    });

    it('start().end() 与 time() 等价', () => {
        const reporter = make();
        const h = reporter.start('CheckerA', 'check');
        h.end();
        expect(reporter.toJSON().checkers['CheckerA'].stages['check'].count).toBe(1);
    });

    it('totalMs 仅累加顶层阶段，不重复计入子阶段', () => {
        const reporter = make();
        reporter.record('CheckerA', 'collectMethods', BigInt(5_000_000));
        reporter.record('CheckerA', 'collectMethods.computeHash', BigInt(2_000_000));
        const checker = reporter.toJSON().checkers['CheckerA'];
        expect(checker.totalMs).toBeCloseTo(5.00, 2);
        expect(checker.stages['collectMethods.computeHash'].totalMs).toBeCloseTo(2.00, 2);
    });

    it('flush() 写出符合 schema 的 JSON', () => {
        const reporter = make();
        reporter.record('CheckerA', 'beforeCheck', BigInt(1_000_000));
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
        const reporter = make();
        reporter.record('CheckerA', 'beforeCheck', BigInt(1_000_000));
        reporter.reset();
        expect(reporter.toJSON().checkers).toEqual({});
    });

    it('dispose() 移除 exit 监听并清空数据', () => {
        const reporter = make();
        reporter.record('CheckerA', 'beforeCheck', BigInt(1_000_000));
        const before = process.listenerCount('exit');
        reporter.dispose();
        const after = process.listenerCount('exit');
        expect(after).toBe(before - 1);
        expect(reporter.toJSON().checkers).toEqual({});
        // 重复 dispose 不应抛
        expect(() => reporter.dispose()).not.toThrow();
    });
});
