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
