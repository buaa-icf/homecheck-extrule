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

/** 内存采样间隔（毫秒）。采样器 unref，不会阻止进程退出。 */
const MEM_SAMPLE_INTERVAL_MS = 200;

function roundMs(ns: bigint): number {
    return Math.round(Number(ns) / 1e4) / 1e2; // ns -> 0.01ms 精度
}

function bytesToMB(bytes: number): number {
    return Math.round((bytes / (1024 * 1024)) * 100) / 100;
}

export class PerfReporterImpl {
    public enabled: boolean;
    private data = new Map<string, Map<string, StageRecord>>();
    private wallStartNs: bigint;
    private wallStartIso: string;
    private exitHookRegistered = false;
    private exitHandler: (() => void) | null = null;
    private peakHeapUsedBytes = 0;
    private peakRssBytes = 0;
    private memSampler: ReturnType<typeof setInterval> | null = null;

    constructor(enabled: boolean) {
        this.enabled = enabled;
        this.wallStartNs = process.hrtime.bigint();
        this.wallStartIso = new Date().toISOString();
        if (enabled) {
            this.registerExitHook();
            this.startMemorySampler();
            this.sampleMemory();
        }
    }

    /** 采样一次进程内存并更新峰值。 */
    public sampleMemory(): void {
        if (!this.enabled) {
            return;
        }
        const usage = process.memoryUsage();
        if (usage.heapUsed > this.peakHeapUsedBytes) {
            this.peakHeapUsedBytes = usage.heapUsed;
        }
        if (usage.rss > this.peakRssBytes) {
            this.peakRssBytes = usage.rss;
        }
    }

    private startMemorySampler(): void {
        if (this.memSampler) {
            return;
        }
        this.memSampler = setInterval(() => this.sampleMemory(), MEM_SAMPLE_INTERVAL_MS);
        // unref：采样器不应阻止进程正常退出。
        if (typeof this.memSampler.unref === 'function') {
            this.memSampler.unref();
        }
    }

    private registerExitHook(): void {
        if (this.exitHookRegistered) {
            return;
        }
        this.exitHookRegistered = true;
        this.exitHandler = () => {
            try {
                this.flush();
            } catch {
                // 退出钩子里吞掉所有异常，避免影响正常退出码
            }
        };
        process.on('exit', this.exitHandler);
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
            rec = { count: 0, totalNs: BigInt(0), minNs: ns, maxNs: ns };
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
            peakHeapUsedMB: bytesToMB(this.peakHeapUsedBytes),
            peakRssMB: bytesToMB(this.peakRssBytes),
            checkers
        };
    }

    public flush(filePath?: string): void {
        if (!this.enabled) {
            return;
        }
        this.sampleMemory(); // 落盘前再采一次，捕获收尾阶段峰值
        const target = filePath ?? path.resolve(process.cwd(), 'report/perfReport.json');
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.writeFileSync(target, JSON.stringify(this.toJSON(), null, 2));
    }

    public reset(): void {
        this.data.clear();
        this.wallStartNs = process.hrtime.bigint();
        this.wallStartIso = new Date().toISOString();
        this.peakHeapUsedBytes = 0;
        this.peakRssBytes = 0;
    }

    /** 测试 / 长驻进程清理：移除 exit 钩子、停止采样器并清空累计。 */
    public dispose(): void {
        if (this.exitHandler) {
            process.removeListener('exit', this.exitHandler);
            this.exitHandler = null;
            this.exitHookRegistered = false;
        }
        if (this.memSampler) {
            clearInterval(this.memSampler);
            this.memSampler = null;
        }
        this.data.clear();
    }
}

export function createPerfReporter(
    enabled: boolean = process.env.EXTRULES_PERF === '1'
): PerfReporterImpl {
    return new PerfReporterImpl(enabled);
}

/** 进程单例：检测器代码统一从这里 import。 */
export const PerfReporter: PerfReporterImpl = createPerfReporter();
