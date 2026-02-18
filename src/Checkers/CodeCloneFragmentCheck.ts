/*
 * Copyright (c) 2024 Huawei Device Co., Ltd.
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import * as fs from 'fs';
import { ArkFile, ArkClass, ArkMethod, Stmt } from "arkanalyzer";
import {
    BaseMetaData,
    Rule,
    MatcherCallback,
    IssueReport,
    FileMatcher,
    MatcherTypes,
    AdviceChecker
} from "homecheck";
import {
    createDefects,
    getMethodEndLine,
    getRuleOption,
    shouldSkipClass,
    shouldSkipMethod
} from "./utils";

import {
    Tokenizer,
    CloneMatcher,
    CloneMerger,
    MergedClone
} from "./FragmentDetection";

/**
 * 克隆范围枚举
 */
export enum CloneScope {
    /** 同一方法内的两段相同代码 */
    SAME_METHOD = 'SAME_METHOD',
    /** 同一类的不同方法中有相同代码 */
    SAME_CLASS = 'SAME_CLASS',
    /** 不同类或顶级函数 */
    DIFFERENT_CLASS = 'DIFFERENT_CLASS'
}

/**
 * 代码位置信息（含方法/类归属）
 */
export interface CodeLocation {
    file: string;
    startLine: number;
    endLine: number;
    className?: string;
    methodName?: string;
}

/**
 * 片段级克隆报告
 */
export interface FragmentCloneReport {
    /** 克隆类型：根据规范化配置决定 */
    cloneType: 'Type-1' | 'Type-2';
    /** 克隆范围 */
    scope: CloneScope;
    /** 位置 1 */
    location1: CodeLocation;
    /** 位置 2 */
    location2: CodeLocation;
    /** Token 数量 */
    tokenCount: number;
    /** 行数 */
    lineCount: number;
}

const gMetaData: BaseMetaData = {
    severity: 2,
    ruleDocPath: "docs/code-clone-fragment-check.md",
    description: 'Code Clone Fragment detected: Similar code fragments found.'
};

/**
 * 代码片段级克隆检测规则
 * 
 * 使用 Token 级别的滑动窗口算法检测代码克隆，
 * 可以发现方法内部、跨方法、跨文件的重复代码。
 */
export class CodeCloneFragmentCheck implements AdviceChecker {
    readonly metaData: BaseMetaData = gMetaData;
    public rule: Rule;
    public issues: IssueReport[] = [];
    public arkFiles: ArkFile[] = [];

    // 默认配置
    private readonly DEFAULT_MINIMUM_TOKENS = 100;
    private readonly DEFAULT_NORMALIZE_IDENTIFIERS = true;
    private readonly DEFAULT_NORMALIZE_LITERALS = false;
    private readonly DEFAULT_IGNORE_LOGS = true;

    // 克隆匹配器和合并器
    private cloneMatcher: CloneMatcher;
    private cloneMerger: CloneMerger;
    private tokenizer: Tokenizer;

    // 缓存 ArkFile 用于反查
    private fileCache: Map<string, ArkFile> = new Map();

    // 文件匹配器 - 匹配所有文件
    private fileMatcher: FileMatcher = {
        matcherType: MatcherTypes.FILE
    };

    constructor() {
        const windowSize = this.DEFAULT_MINIMUM_TOKENS;
        this.cloneMatcher = new CloneMatcher(windowSize);
        this.cloneMerger = new CloneMerger(windowSize);
        this.tokenizer = new Tokenizer({
            normalizeIdentifiers: this.DEFAULT_NORMALIZE_IDENTIFIERS,
            normalizeLiterals: this.DEFAULT_NORMALIZE_LITERALS
        });
    }

    /**
     * 检测前初始化
     */
    public beforeCheck(): void {
        const minimumTokens = this.getMinimumTokens();
        const normalizeIdentifiers = this.getNormalizeIdentifiers();
        const normalizeLiterals = this.getNormalizeLiterals();

        // 重新初始化组件
        this.cloneMatcher = new CloneMatcher(minimumTokens);
        this.cloneMerger = new CloneMerger(minimumTokens);
        this.tokenizer = new Tokenizer({
            normalizeIdentifiers,
            normalizeLiterals
        });

        this.fileCache.clear();
        this.issues = [];
    }

    /**
     * 空的 check 方法
     */
    public check = (): void => {}

    public registerMatchers(): MatcherCallback[] {
        const matchFileCb: MatcherCallback = {
            matcher: this.fileMatcher,
            callback: this.collectTokens
        };
        return [matchFileCb];
    }

    /**
     * 收集文件的 Token 并处理
     */
    public collectTokens = (arkFile: ArkFile): void => {
        const filePath = arkFile.getFilePath();
        const minimumTokens = this.getMinimumTokens();

        try {
            // 读取源文件内容
            let sourceCode = this.readSourceFile(filePath);
            if (!sourceCode) {
                return;
            }

            // 缓存 ArkFile 用于后续反查（放在日志过滤之前，因为过滤需要用到）
            this.fileCache.set(filePath, arkFile);

            // 日志过滤：在 Tokenize 之前，将日志语句行替换为空行
            if (this.getIgnoreLogs()) {
                sourceCode = this.removeLogLines(sourceCode, arkFile);
            }

            // Tokenize
            const tokens = this.tokenizer.tokenize(sourceCode, filePath);

            if (tokens.length < minimumTokens) {
                return;
            }

            // 送入匹配器
            this.cloneMatcher.processFile(tokens, filePath);

        } catch {
            return;
        }
    }

    /**
     * 检测完成后，生成报告
     */
    public afterCheck(): void {
        // 获取克隆对
        const clonePairs = this.cloneMatcher.getClonePairs();

        if (clonePairs.length === 0) {
            return;
        }

        // 合并连续片段
        const mergedClones = this.cloneMerger.merge(clonePairs);

        // 生成报告
        for (const clone of mergedClones) {
            const report = this.createCloneReport(clone);
            if (report) {
                this.addIssueReport(report);
            }
        }

    }

    /**
     * 读取源文件内容
     */
    private readSourceFile(filePath: string): string | null {
        try {
            return fs.readFileSync(filePath, 'utf-8');
        } catch (error) {
            return null;
        }
    }

    /**
     * 创建克隆报告
     */
    private createCloneReport(clone: MergedClone): FragmentCloneReport | null {
        const { location1, location2, tokenCount } = clone;

        // 反查方法/类归属
        const codeLocation1 = this.resolveCodeLocation(
            location1.file,
            location1.startLine,
            location1.endLine
        );
        const codeLocation2 = this.resolveCodeLocation(
            location2.file,
            location2.startLine,
            location2.endLine
        );

        // 判定克隆范围
        const scope = this.determineScope(codeLocation1, codeLocation2);

        // 判定克隆类型
        const cloneType = this.determineCloneType();

        // 计算行数
        const lineCount1 = location1.endLine - location1.startLine + 1;
        const lineCount2 = location2.endLine - location2.startLine + 1;
        const lineCount = Math.max(lineCount1, lineCount2);

        return {
            cloneType,
            scope,
            location1: codeLocation1,
            location2: codeLocation2,
            tokenCount,
            lineCount
        };
    }

    /**
     * 反查代码位置的方法/类归属
     */
    private resolveCodeLocation(file: string, startLine: number, endLine: number): CodeLocation {
        const location: CodeLocation = {
            file,
            startLine,
            endLine
        };

        const arkFile = this.fileCache.get(file);
        if (!arkFile) {
            return location;
        }

        // 遍历类和方法，查找包含该行范围的方法
        for (const arkClass of arkFile.getClasses()) {
            const className = arkClass.getName();

            // 跳过默认类
            if (shouldSkipClass(className)) {
                continue;
            }

            for (const method of arkClass.getMethods()) {
                const methodName = method.getName();

                // 跳过默认方法
                if (shouldSkipMethod(methodName)) {
                    continue;
                }

                const methodStartLine = method.getLine() ?? 0;
                const methodEndLine = this.getMethodEndLine(method);

                // 检查行范围是否在方法内
                if (startLine >= methodStartLine && endLine <= methodEndLine) {
                    location.className = className;
                    location.methodName = methodName;
                    return location;
                }
            }
        }

        return location;
    }

    /**
     * 获取方法结束行号
     */
    private getMethodEndLine(method: ArkMethod): number {
        return getMethodEndLine(method);
    }

    /**
     * 判定克隆范围
     */
    private determineScope(loc1: CodeLocation, loc2: CodeLocation): CloneScope {
        // 同一方法
        if (loc1.file === loc2.file &&
            loc1.className === loc2.className &&
            loc1.methodName === loc2.methodName &&
            loc1.methodName !== undefined) {
            return CloneScope.SAME_METHOD;
        }

        // 同一类的不同方法
        if (loc1.file === loc2.file &&
            loc1.className === loc2.className &&
            loc1.className !== undefined) {
            return CloneScope.SAME_CLASS;
        }

        // 不同类
        return CloneScope.DIFFERENT_CLASS;
    }

    /**
     * 判定克隆类型
     */
    private determineCloneType(): 'Type-1' | 'Type-2' {
        const normalizeIdentifiers = this.getNormalizeIdentifiers();
        const normalizeLiterals = this.getNormalizeLiterals();

        // 如果没有做任何规范化，就是 Type-1
        if (!normalizeIdentifiers && !normalizeLiterals) {
            return 'Type-1';
        }

        return 'Type-2';
    }

    /**
     * 添加问题报告
     */
    private addIssueReport(report: FragmentCloneReport): void {
        const severity = this.rule?.alert ?? this.metaData.severity;
        const description = this.formatDescription(report);

        this.issues.push(createDefects({
            line: report.location1.startLine,
            startCol: 0,
            endCol: 0,
            description,
            severity,
            ruleId: this.rule.ruleId,
            filePath: report.location1.file,
            ruleDocPath: this.metaData.ruleDocPath,
            methodName: report.location1.methodName ?? ''
        }));
    }

    /**
     * 格式化描述信息
     */
    private formatDescription(report: FragmentCloneReport): string {
        const { cloneType, scope, location1, location2, tokenCount, lineCount } = report;

        const scopeDesc = this.getScopeDescription(scope);
        const loc1Desc = this.formatLocation(location1);
        const loc2Desc = this.formatLocation(location2);

        return `Code Clone ${cloneType} (${scopeDesc}): ${loc1Desc} is similar to ${loc2Desc}. (${tokenCount} tokens, ${lineCount} lines)`;
    }

    /**
     * 获取范围描述
     */
    private getScopeDescription(scope: CloneScope): string {
        switch (scope) {
            case CloneScope.SAME_METHOD:
                return 'same method';
            case CloneScope.SAME_CLASS:
                return 'same class';
            case CloneScope.DIFFERENT_CLASS:
                return 'different classes';
            default:
                return 'unknown';
        }
    }

    /**
     * 格式化位置信息
     * 
     * 使用完整路径，确保 Homecheck 的 mergeKey 绝对唯一，不会误合并。
     * 之前用 shortPath（最后 3 级）导致不同子项目下的同名文件被去重，
     * 271 个 issue 只剩 43 个。改为完整路径后彻底根治。
     */
    private formatLocation(loc: CodeLocation): string {
        if (loc.className && loc.methodName) {
            return `${loc.file} > ${loc.className}.${loc.methodName}():${loc.startLine}-${loc.endLine}`;
        } else if (loc.className) {
            return `${loc.file} > ${loc.className}:${loc.startLine}-${loc.endLine}`;
        } else {
            return `${loc.file}:${loc.startLine}-${loc.endLine}`;
        }
    }

    // ========== 日志过滤方法 ==========

    /**
     * 判断一个 IR 语句是否为纯日志语句
     * 
     * 复用方法级 CodeCloneBaseCheck 的日志识别模式。
     * 支持：console.*, hilog.*, Logger.*
     */
    private isLogStatement(stmt: Stmt): boolean {
        const text = stmt.toString().trim();
        const logPattern = /^(console|hilog|Logger)\.\w+\s*\([\s\S]*\)$/i;
        return logPattern.test(text);
    }

    /**
     * 收集 ArkFile 中所有日志语句所占据的行号集合
     * 
     * 遍历文件中所有类的所有方法（包括默认类/默认方法，即顶层代码），
     * 对每个方法的 Stmt 列表：
     *   1. 找到日志语句的起始行
     *   2. 用下一条语句的起始行-1 作为结束行（最后一条用方法结束行）
     *   3. 将该范围内所有行号加入集合
     */
    public collectLogLines(arkFile: ArkFile): Set<number> {
        const logLines = new Set<number>();

        for (const arkClass of arkFile.getClasses()) {
            for (const method of arkClass.getMethods()) {
                const body = method.getBody();
                if (!body) continue;

                const stmts = body.getCfg().getStmts();
                if (stmts.length === 0) continue;

                // 计算方法结束行（作为最后一条语句的结束边界）
                const methodEndLine = this.getMethodEndLine(method);

                for (let i = 0; i < stmts.length; i++) {
                    if (!this.isLogStatement(stmts[i])) continue;

                    const startLine = stmts[i].getOriginPositionInfo().getLineNo();
                    if (startLine <= 0) continue;

                    // 结束行 = 下一条语句起始行 - 1，或方法结束行
                    let endLine: number;
                    if (i + 1 < stmts.length) {
                        const nextLine = stmts[i + 1].getOriginPositionInfo().getLineNo();
                        endLine = nextLine > startLine ? nextLine - 1 : startLine;
                    } else {
                        endLine = methodEndLine;
                    }

                    for (let line = startLine; line <= endLine; line++) {
                        logLines.add(line);
                    }
                }
            }
        }

        return logLines;
    }

    /**
     * 将源码中日志语句所在行替换为空行
     * 
     * 替换为空行而非删除，以保持行号不变。
     */
    public removeLogLines(sourceCode: string, arkFile: ArkFile): string {
        const logLines = this.collectLogLines(arkFile);
        if (logLines.size === 0) {
            return sourceCode;
        }

        const lines = sourceCode.split('\n');
        for (const lineNo of logLines) {
            // ArkAnalyzer 行号从 1 开始，数组索引从 0 开始
            const idx = lineNo - 1;
            if (idx >= 0 && idx < lines.length) {
                lines[idx] = '';
            }
        }

        console.log(`[CodeCloneFragment] Removed ${logLines.size} log lines from ${arkFile.getFilePath()}`);
        return lines.join('\n');
    }

    // ========== 配置读取方法 ==========

    /**
     * 获取是否忽略日志语句配置
     * 
     * 日志语句（console.log、hilog、Logger 等）通常只是调试信息，
     * 不影响业务逻辑，默认过滤以减少噪声。
     * 
     * 配置方式：{ "ignoreLogs": false }
     * 默认值：true（开启日志过滤）
     */
    private getIgnoreLogs(): boolean {
        if (this.rule && this.rule.option && this.rule.option.length > 0) {
            const firstOption = this.rule.option[0] as any;
            if (typeof firstOption.ignoreLogs === 'boolean') {
                return firstOption.ignoreLogs;
            }
        }
        return this.DEFAULT_IGNORE_LOGS;
    }

    /**
     * 获取最小 Token 数配置
     */
    private getConfig() {
        return getRuleOption(this.rule, {
            minimumTokens: this.DEFAULT_MINIMUM_TOKENS,
            normalizeIdentifiers: this.DEFAULT_NORMALIZE_IDENTIFIERS,
            normalizeLiterals: this.DEFAULT_NORMALIZE_LITERALS
        });
    }

    private getMinimumTokens(): number {
        return this.getConfig().minimumTokens;
    }

    private getNormalizeIdentifiers(): boolean {
        return this.getConfig().normalizeIdentifiers;
    }

    private getNormalizeLiterals(): boolean {
        return this.getConfig().normalizeLiterals;
    }
}
