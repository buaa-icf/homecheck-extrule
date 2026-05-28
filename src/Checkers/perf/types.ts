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
    /** 检测阶段观测到的进程堆内存峰值（MB，两位小数）。 */
    peakHeapUsedMB: number;
    /** 检测阶段观测到的进程常驻内存(RSS)峰值（MB，两位小数）。 */
    peakRssMB: number;
    checkers: Record<string, CheckerReportJson>;
}
