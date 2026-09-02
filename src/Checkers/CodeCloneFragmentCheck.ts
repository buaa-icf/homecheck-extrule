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

import { ArkFile } from "arkanalyzer";
import {
    AdviceChecker,
    BaseMetaData,
    FileMatcher,
    IssueReport,
    MatcherCallback,
    MatcherTypes,
    Rule
} from "homecheck";
import { createDefects } from "./shared";
import {
    buildFragmentCloneReport,
    CodeLocation,
    detectCloneType,
    determineClassScope,
    determineScope,
    formatDescription as formatDescriptionUtil,
    formatLocation as formatLocationUtil,
    FragmentCloneClassReport,
    FragmentCloneDiagnostics,
    FragmentCloneReport,
    getScopeDescription as getScopeDescriptionUtil,
    parseFragmentCloneOptions,
    removeLogLines,
    resolveCodeLocationFromCache,
    createEmptyDiagnostics,
    readSourceFile
} from "./fragment-clone";
import { FragmentCloneRuleOptions } from "./config/types";
import {
    CloneMatcher,
    deduplicateMergedClones,
    ExactCloneClassBuilder,
    filterSelfOverlappingClones,
    MergedCloneClass,
    MergedClone,
    NearMissClone,
    NearMissDetector,
    Token,
    Tokenizer
} from "./FragmentDetection";
import { PerfReporter } from "./perf";

const gMetaData: BaseMetaData = {
    severity: 2,
    ruleDocPath: "docs/code-clone-fragment-check.md",
    description: "Code Clone Fragment detected: Similar code fragments found."
};

/**
 * 片段级克隆规则实现。
 *
 * 主要流程：
 * 1. 文件读取与可选日志过滤；
 * 2. Token 化 + 滑窗匹配；
 * 3. 克隆片段合并与去重；
 * 4. 可选近似克隆检测与最终报告。
 */
export class CodeCloneFragmentCheck implements AdviceChecker {
    readonly metaData: BaseMetaData = gMetaData;
    public rule: Rule;
    public issues: IssueReport[] = [];
    public arkFiles: ArkFile[] = [];

    private options: FragmentCloneRuleOptions = parseFragmentCloneOptions();
    private diagnostics: FragmentCloneDiagnostics = createEmptyDiagnostics();

    private cloneMatcher: CloneMatcher;
    private exactCloneClassBuilder: ExactCloneClassBuilder = new ExactCloneClassBuilder();
    private tokenizer: Tokenizer;

    private fileTokenCache: Map<string, Token[]> = new Map();
    private fileCache: Map<string, ArkFile> = new Map();
    private locationCache: Map<string, CodeLocation> = new Map();

    private fileMatcher: FileMatcher = {
        matcherType: MatcherTypes.FILE
    };

    constructor() {
        this.cloneMatcher = this.createCloneMatcher(this.options);
        this.tokenizer = this.createTokenizer(this.options);
    }

    /**
     * 每轮检测开始时重置配置与缓存状态。
     */
    public beforeCheck(): void {
        PerfReporter.time(this.constructor.name, 'beforeCheck', () => {
            this.options = parseFragmentCloneOptions(this.rule);
            this.diagnostics = createEmptyDiagnostics();
            this.issues = [];
            this.fileCache.clear();
            this.fileTokenCache.clear();
            this.locationCache.clear();

            this.cloneMatcher = this.createCloneMatcher(this.options);
            this.tokenizer = this.createTokenizer(this.options);
        });
    }

    public check = (): void => {}

    /**
     * 注册 FILE 级回调，逐文件收集 token。
     */
    public registerMatchers(): MatcherCallback[] {
        const matchFileCb: MatcherCallback = {
            matcher: this.fileMatcher,
            callback: this.collectTokens
        };
        return [matchFileCb];
    }

    /**
     * 读取源码、执行预处理并将 token 送入匹配器。
     */
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

            if (this.options.ignoreLogs) {
                const narrowed = sourceCode;
                sourceCode = PerfReporter.time(
                    checkerName,
                    'collectTokens.removeLogLines',
                    () => removeLogLines(narrowed, arkFile)
                );
            }

            try {
                const narrowedSource = sourceCode;
                const tokens = PerfReporter.time(
                    checkerName,
                    'collectTokens.tokenize',
                    () => this.tokenizer.tokenize(narrowedSource, filePath)
                );
                if (tokens.length < this.options.minimumTokens) {
                    return;
                }

                if (!hasEnoughDistinctTokenTypes(tokens, this.options.minDistinctTokenTypes)) {
                    return;
                }

                PerfReporter.time(
                    checkerName,
                    'collectTokens.processFile',
                    () => this.cloneMatcher.processFile(tokens, filePath)
                );
                this.fileCache.set(filePath, arkFile);
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

    /**
     * 收尾阶段统一生成 issue。
     */
    public afterCheck(): void {
        const checkerName = this.constructor.name;
        try {
            PerfReporter.time(checkerName, 'afterCheck', () => {
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

            const threshold = this.options.similarityThreshold;
            const nearMissClones = threshold < 1.0
                ? PerfReporter.time(
                    checkerName,
                    'afterCheck.findNearMissClones',
                    () => this.findNearMissClones(threshold)
                )
                : [];

            if (exactClones.length === 0 && nearMissClones.length === 0) {
                return;
            }

            PerfReporter.time(checkerName, 'afterCheck.reportGen', () => {
                if (this.options.enableCloneClasses) {
                    const classReports = this.createCloneClassReportsFromMergedClasses(exactCloneClasses);
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
        } finally {
            this.releaseScanCaches();
        }
    }

    /** 报告生成后立即释放全仓 Token、哈希索引和 ArkFile 引用。 */
    private releaseScanCaches(): void {
        this.cloneMatcher.clear();
        this.fileTokenCache.clear();
        this.fileCache.clear();
        this.locationCache.clear();
    }

    /**
     * 根据配置构造 Tokenizer。
     */
    private createTokenizer(options: FragmentCloneRuleOptions): Tokenizer {
        return new Tokenizer({
            normalizeIdentifiers: options.normalizeIdentifiers,
            normalizeLiterals: options.normalizeLiterals,
            ignoreTypes: options.ignoreTypes,
            ignoreDecorators: options.ignoreDecorators
        });
    }

    private createCloneMatcher(options: FragmentCloneRuleOptions): CloneMatcher {
        return new CloneMatcher(options.minimumTokens, {
            maxPairsPerFingerprint: options.maxPairsPerFingerprint
        });
    }

    /**
     * 近似克隆（Type-3）检测并做同文件重叠过滤与去重。
     */
    private findNearMissClones(threshold: number): NearMissClone[] {
        const detector = new NearMissDetector(this.options.minimumTokens, threshold);

        for (const [filePath, tokens] of this.fileTokenCache) {
            detector.addFile(tokens, filePath);
        }

        const rawResults = detector.detect();
        return deduplicateMergedClones(filterSelfOverlappingClones(rawResults)) as NearMissClone[];
    }

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

    /**
     * 精确克隆报告对象构建。
     */
    private createCloneReport(clone: MergedClone): FragmentCloneReport {
        return buildFragmentCloneReport(
            clone,
            detectCloneType(this.options),
            (loc1, loc2) => determineScope(loc1, loc2),
            (file, startLine, endLine) => this.resolveCodeLocation(file, startLine, endLine)
        );
    }

    /**
     * 近似克隆报告对象构建。
     */
    private createNearMissReport(clone: NearMissClone): FragmentCloneReport {
        return buildFragmentCloneReport(
            clone,
            "Type-3",
            (loc1, loc2) => determineScope(loc1, loc2),
            (file, startLine, endLine) => this.resolveCodeLocation(file, startLine, endLine)
        );
    }

    /**
     * 基于缓存 ArkFile 反查片段归属（类/方法）。
     */
    private resolveCodeLocation(file: string, startLine: number, endLine: number): CodeLocation {
        const cacheKey = `${file}\0${startLine}\0${endLine}`;
        const cached = this.locationCache.get(cacheKey);
        if (cached !== undefined) {
            return cached;
        }

        const location = resolveCodeLocationFromCache(this.fileCache, file, startLine, endLine);
        this.locationCache.set(cacheKey, location);
        return location;
    }

    /**
     * 单条片段克隆 issue 上报。
     */
    private addIssueReport(report: FragmentCloneReport): void {
        const severity = this.rule?.alert ?? this.metaData.severity;
        const description = formatDescriptionUtil(report);

        this.issues.push(createDefects({
            line: report.location1.startLine,
            startCol: 0,
            endCol: 0,
            description,
            severity,
            ruleId: this.rule.ruleId,
            filePath: report.location1.file,
            ruleDocPath: this.metaData.ruleDocPath,
            methodName: report.location1.methodName ?? ""
        }));
    }

    /**
     * 克隆类 issue 上报。
     */
    private addCloneClassIssueReport(report: FragmentCloneClassReport): void {
        const anchor = report.members[0];
        const severity = this.rule?.alert ?? this.metaData.severity;
        const scopeDesc = getScopeDescriptionUtil(report.scope);
        const memberDesc = report.members.map(member => formatLocationUtil(member)).join("; ");
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
            methodName: anchor.methodName ?? ""
        }));
    }

    /**
     * 暴露可观测诊断数据，避免直接泄漏内部数组引用。
     */
    public getDiagnostics(): FragmentCloneDiagnostics {
        return {
            ...this.diagnostics,
            errors: [...this.diagnostics.errors]
        };
    }
}

function hasEnoughDistinctTokenTypes(tokens: Token[], minDistinctTokenTypes: number): boolean {
    if (minDistinctTokenTypes <= 0) {
        return true;
    }

    const distinctTypes = new Set<Token['type']>();
    for (const token of tokens) {
        distinctTypes.add(token.type);
        if (distinctTypes.size >= minDistinctTokenTypes) {
            return true;
        }
    }

    return false;
}
