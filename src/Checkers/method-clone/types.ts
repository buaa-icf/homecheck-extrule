import { ArkMethod } from "arkanalyzer";

export interface MethodInfo {
    method: ArkMethod;
    filePath: string;
    className: string;
    methodName: string;
    startLine: number;
    endLine: number;
    hash: string;
    normalizedContent: string;
    normalizedTokens: string[];
    tokenMultiset?: Map<string, number>;
    stmtCount: number;
}

export interface ClonePair {
    method1: MethodInfo;
    method2: MethodInfo;
    similarity?: number;
}
