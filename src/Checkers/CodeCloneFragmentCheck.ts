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

import { ArkFile, ArkMethod } from "arkanalyzer";
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
    shouldSkipClass,
    shouldSkipMethod
} from "./utils";
import {
    collectLogLines as collectLogLinesInSource,
    FragmentCloneDiagnostics,
    createEmptyDiagnostics,
    parseFragmentCloneOptions,
    removeLogLines as removeLogLinesInSource,
    readSourceFile
} from "./fragment-clone";
import { FragmentCloneRuleOptions } from "./config/types";

import {
    Tokenizer,
    Token,
    CloneMatcher,
    CloneMerger,
    MergedClone,
    CloneClass,
    classifyClones,
    NearMissDetector,
    NearMissClone,
    filterSelfOverlappingClones,
    deduplicateMergedClones
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
    cloneType: 'Type-1' | 'Type-2' | 'Type-3';
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
    /** 近似克隆相似度（仅 Type-3 报告有值） */
    similarity?: number;
}

/**
 * 片段级克隆类报告
 */
export interface FragmentCloneClassReport {
    cloneType: 'Type-1' | 'Type-2' | 'Type-3';
    scope: CloneScope;
    classId: number;
    members: CodeLocation[];
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

    // 统一配置对象（beforeCheck 一次解析）
    private options: FragmentCloneRuleOptions = parseFragmentCloneOptions();
    private optionsInitialized: boolean = false;
    private diagnostics: FragmentCloneDiagnostics = createEmptyDiagnostics();

    // 克隆匹配器和合并器
    private cloneMatcher: CloneMatcher;
    private cloneMerger: CloneMerger;
    private tokenizer: Tokenizer;

    // 缓存每个文件的 Token 序列（用于近似克隆检测）
    private fileTokenCache: Map<string, Token[]> = new Map();

    // 缓存 ArkFile 用于反查
    private fileCache: Map<string, ArkFile> = new Map();

    // 文件匹配器 - 匹配所有文件
    private fileMatcher: FileMatcher = {
        matcherType: MatcherTypes.FILE
    };

    constructor() {
        const windowSize = this.options.minimumTokens;
        this.cloneMatcher = new CloneMatcher(windowSize);
        this.cloneMerger = new CloneMerger(windowSize);
        this.tokenizer = new Tokenizer({
            normalizeIdentifiers: this.options.normalizeIdentifiers,
            normalizeLiterals: this.options.normalizeLiterals,
            ignoreTypes: this.options.ignoreTypes,
            ignoreDecorators: this.options.ignoreDecorators
        });
    }

    /**
     * 检测前初始化
     */
    public beforeCheck(): void {
        this.options = parseFragmentCloneOptions(this.rule);
        this.optionsInitialized = true;
        this.diagnostics = createEmptyDiagnostics();
        const minimumTokens = this.options.minimumTokens;
        const normalizeIdentifiers = this.options.normalizeIdentifiers;
        const normalizeLiterals = this.options.normalizeLiterals;

        // 重新初始化组件
        this.cloneMatcher = new CloneMatcher(minimumTokens);
        this.cloneMerger = new CloneMerger(minimumTokens);
        this.tokenizer = new Tokenizer({
            normalizeIdentifiers,
            normalizeLiterals,
            ignoreTypes: this.options.ignoreTypes,
            ignoreDecorators: this.options.ignoreDecorators
        });

        this.fileCache.clear();
        this.issues = [];
        this.fileTokenCache.clear();
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

        // 缓存 ArkFile 用于后续反查（放在日志过滤之前，因为过滤需要用到）
        this.fileCache.set(filePath, arkFile);

        // 日志过滤：在 Tokenize 之前，将日志语句行替换为空行
        if (this.getIgnoreLogs()) {
            sourceCode = this.removeLogLines(sourceCode, arkFile);
        }

        try {
            // Tokenize
            const tokens = this.tokenizer.tokenize(sourceCode, filePath);

            if (tokens.length < minimumTokens) {
                return;
            }

            // 复杂度门控：如果不同 token 类型数量低于阈值，则跳过该文件
            const minDistinctTokenTypes = this.getMinDistinctTokenTypes();
            if (minDistinctTokenTypes > 0) {
                const distinctTypes = new Set(tokens.map(t => t.type)).size;
                if (distinctTypes < minDistinctTokenTypes) {
                    return;
                }
            }

            // 送入匹配器
            this.cloneMatcher.processFile(tokens, filePath);

            // 缓存 Token 序列（用于近似克隆检测）
            this.fileTokenCache.set(filePath, tokens);
        } catch (error) {
            this.diagnostics.filesProcessFailed++;
            this.diagnostics.errors.push({
                filePath,
                phase: "process",
                message: error instanceof Error ? error.message : "failed to process file"
            });
            return;
        }
    }

    /**
     * 检测完成后，生成报告
     */
    public afterCheck(): void {
        // 获取克隆对
        const clonePairs = this.cloneMatcher.getClonePairs();

        // 合并连续片段（精确匹配）
        const allMergedClones = clonePairs.length > 0
            ? this.cloneMerger.merge(clonePairs)
            : [];

        // 过滤1：排除同文件重叠行范围的自身克隆（使用共享工具）
        const nonSelfClones = filterSelfOverlappingClones(allMergedClones);

        // 过滤2：去重行范围重叠的克隆（使用共享工具）
        const exactClones = deduplicateMergedClones(nonSelfClones);

        // Type-3 近似克隆检测
        const threshold = this.getSimilarityThreshold();
        let nearMissClones: NearMissClone[] = [];
        if (threshold < 1.0) {
            nearMissClones = this.findNearMissClones(threshold);
        }

        // 合并精确匹配和近似匹配结果
        const allClones: MergedClone[] = [...exactClones, ...nearMissClones];

        if (allClones.length === 0) {
            return;
        }

        if (this.getEnableCloneClasses()) {
            const classReports = this.createCloneClassReports(exactClones);
            for (const report of classReports) {
                this.addCloneClassIssueReport(report);
            }
            return;
        }

        // 生成精确匹配报告
        for (const clone of exactClones) {
            const report = this.createCloneReport(clone);
            if (report) {
                this.addIssueReport(report);
            }
        }

        // 生成近似匹配报告
        for (const clone of nearMissClones) {
            const report = this.createNearMissReport(clone);
            if (report) {
                this.addIssueReport(report);
            }
        }
    }

    /**
     * 执行 Type-3 近似克隆检测
     *
     * 使用 NearMissDetector 对缓存的 Token 序列进行两阶段检测：
     * 1. Q-gram 轮廓 Jaccard 预筛选（候选生成）
     * 2. LCS 相似度精确验证
     *
     * @param threshold 相似度阈值
     * @returns 近似克隆列表
     */
    private findNearMissClones(threshold: number): NearMissClone[] {
        const minimumTokens = this.getMinimumTokens();
        const detector = new NearMissDetector(minimumTokens, threshold);

        for (const [filePath, tokens] of this.fileTokenCache) {
            detector.addFile(tokens, filePath);
        }

        const rawResults = detector.detect();

        // 过滤自身重叠 + 去重
        const nonSelf = filterSelfOverlappingClones(rawResults);
        return deduplicateMergedClones(nonSelf) as NearMissClone[];
    }

    private createCloneClassReports(clones: MergedClone[]): FragmentCloneClassReport[] {
        const classes = classifyClones(clones);
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
                cloneType: this.determineCloneType(),
                scope: this.determineClassScope(members),
                classId: cloneClass.classId,
                members
            });
        }

        return reports;
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
     * 创建近似克隆报告（Type-3）
     */
    private createNearMissReport(clone: NearMissClone): FragmentCloneReport | null {
        const { location1, location2, tokenCount, similarity } = clone;

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

        const scope = this.determineScope(codeLocation1, codeLocation2);
        const lineCount1 = location1.endLine - location1.startLine + 1;
        const lineCount2 = location2.endLine - location2.startLine + 1;
        const lineCount = Math.max(lineCount1, lineCount2);

        return {
            cloneType: 'Type-3',
            scope,
            location1: codeLocation1,
            location2: codeLocation2,
            tokenCount,
            lineCount,
            similarity
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
        const { cloneType, scope, location1, location2, tokenCount, lineCount, similarity } = report;

        const scopeDesc = this.getScopeDescription(scope);
        const loc1Desc = this.formatLocation(location1, false);
        const loc2Desc = this.formatLocation(location2, true);

        if (similarity !== undefined && similarity < 1.0) {
            const pct = Math.round(similarity * 100);
            return `Code Clone ${cloneType} (${scopeDesc}): ${loc1Desc} is similar to ${loc2Desc}. (${tokenCount} tokens, ${lineCount} lines, ${pct}% similar)`;
        }

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

    private determineClassScope(members: CodeLocation[]): CloneScope {
        if (members.length < 2) {
            return CloneScope.DIFFERENT_CLASS;
        }

        const first = members[0];
        const allSameMethod = members.every(member =>
            member.file === first.file &&
            member.className === first.className &&
            member.methodName === first.methodName &&
            member.methodName !== undefined
        );
        if (allSameMethod) {
            return CloneScope.SAME_METHOD;
        }

        const allSameClass = members.every(member =>
            member.file === first.file &&
            member.className === first.className &&
            member.className !== undefined
        );
        if (allSameClass) {
            return CloneScope.SAME_CLASS;
        }

        return CloneScope.DIFFERENT_CLASS;
    }

    private addCloneClassIssueReport(report: FragmentCloneClassReport): void {
        const anchor = report.members[0];
        const severity = this.rule?.alert ?? this.metaData.severity;
        const scopeDesc = this.getScopeDescription(report.scope);
        const memberDesc = report.members.map(member => this.formatLocation(member)).join('; ');
        const description = `Code Clone ${report.cloneType} (${scopeDesc}) [Class #${report.classId}, ${report.members.length} members]: ${memberDesc}.`;

        this.issues.push(createDefects({
            line: anchor.startLine,
            startCol: 0,
            endCol: 0,
            description,
            severity,
            ruleId: this.rule.ruleId,
            filePath: anchor.file,
            ruleDocPath: this.metaData.ruleDocPath,
            methodName: anchor.methodName ?? ''
        }));
    }

    /**
     * 格式化位置信息
     *
     * 仅在 message 中显示文件名，避免描述过长。
     * source 文件完整路径由 defect.filePath 单独提供。
     */
    private formatLocation(loc: CodeLocation, useFullPath: boolean = false): string {
        const fileName = loc.file.split('/').pop() ?? loc.file;
        const filePart = useFullPath ? loc.file : fileName;
        if (loc.className && loc.methodName) {
            return `${filePart} > ${loc.className}.${loc.methodName}():${loc.startLine}-${loc.endLine}`;
        } else if (loc.className) {
            return `${filePart} > ${loc.className}:${loc.startLine}-${loc.endLine}`;
        } else {
            return `${filePart}:${loc.startLine}-${loc.endLine}`;
        }
    }

    // ========== 日志过滤方法 ==========

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
        return collectLogLinesInSource(arkFile);
    }

    /**
     * 将源码中日志语句所在行替换为空行
     * 
     * 替换为空行而非删除，以保持行号不变。
     */
    public removeLogLines(sourceCode: string, arkFile: ArkFile): string {
        return removeLogLinesInSource(sourceCode, arkFile);
    }

    // ========== 配置读取方法 ==========

    private getOptions(): FragmentCloneRuleOptions {
        if (!this.optionsInitialized) {
            this.options = parseFragmentCloneOptions(this.rule);
            this.optionsInitialized = true;
        }
        return this.options;
    }

    private getEnableCloneClasses(): boolean {
        return this.getOptions().enableCloneClasses;
    }

    private getIgnoreLogs(): boolean {
        return this.getOptions().ignoreLogs;
    }

    private getMinimumTokens(): number {
        return this.getOptions().minimumTokens;
    }

    private getNormalizeIdentifiers(): boolean {
        return this.getOptions().normalizeIdentifiers;
    }

    private getNormalizeLiterals(): boolean {
        return this.getOptions().normalizeLiterals;
    }

    private getIgnoreTypes(): boolean {
        return this.getOptions().ignoreTypes;
    }

    private getIgnoreDecorators(): boolean {
        return this.getOptions().ignoreDecorators;
    }

    /**
     * 从配置中获取最小不同 token 类型数阈值
     *
     * 用于过滤过于简单的文件（例如只包含关键字和标点的简单声明文件）。
     * 只有当文件的 token 类型多样性达到阈值时才进行克隆检测。
     *
     * 默认值：0（禁用，不过滤任何文件）
     */
    private getMinDistinctTokenTypes(): number {
        return this.getOptions().minDistinctTokenTypes;
    }

    /**
     * 从配置中获取片段级近似克隆相似度阈值
     *
     * 设为 1.0 时仅报告精确匹配的克隆（默认行为）。
     * 设为 0.7~0.9 时，还会报告对应百分比以上相似的片段（Type-3）。
     *
     * 默认值：1.0（禁用近似克隆检测，保持向后兼容）
     */
    private getSimilarityThreshold(): number {
        return this.getOptions().similarityThreshold;
    }

    public getDiagnostics(): FragmentCloneDiagnostics {
        return {
            ...this.diagnostics,
            errors: [...this.diagnostics.errors]
        };
    }
}
