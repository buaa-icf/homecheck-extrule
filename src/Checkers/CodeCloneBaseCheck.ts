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

import { ArkFile, ArkMethod, Stmt } from "arkanalyzer";
import {
    AdviceChecker,
    BaseMetaData,
    FileMatcher,
    IssueReport,
    MatcherCallback,
    MatcherTypes,
    Rule
} from "homecheck";
import {
    appendToBucket,
    createDefects,
    djb2Hash,
    getMethodEndLine,
    isLogStatement as isLogStatementUtil,
    normalizeBasic as normalizeBasicText,
    shouldSkipClass,
    shouldSkipMethod
} from "./shared";
import { parseRuleOptions } from "./config/parseRuleOptions";
import { MethodCloneRuleOptions } from "./config/types";
import {
    buildTokenMultiset,
    classifyMethodClonePairs,
    collectExactClonePairs,
    collectNearMissClonePairs,
    DEFAULT_METHOD_CLONE_OPTIONS,
    formatMethodCloneAnchor,
    formatMethodCloneMembers,
    formatMethodCloneTarget,
    getPairKey as buildPairKey,
    jaccardSimilarityFromMultisets,
    METHOD_CLONE_OPTIONS_SCHEMA,
    ClonePair,
    MethodInfo
} from "./method-clone";

/**
 * 方法级克隆检测基类。
 *
 * 职责：
 * 1. 收集方法并做基础过滤；
 * 2. 组织精确克隆与近似克隆检测流程；
 * 3. 统一构建 Issue 报告。
 */
export abstract class CodeCloneBaseCheck implements AdviceChecker {
    abstract readonly metaData: BaseMetaData;
    public rule: Rule;
    public issues: IssueReport[] = [];
    public arkFiles: ArkFile[] = [];

    protected options: MethodCloneRuleOptions = { ...DEFAULT_METHOD_CLONE_OPTIONS };
    private optionsResolved: boolean = false;

    protected methodsByHash: Map<string, MethodInfo[]> = new Map();
    protected collectedMethodKeys: Set<string> = new Set();
    protected reportedPairs: Set<string> = new Set();
    protected collectedPairs: ClonePair[] = [];

    private fileMatcher: FileMatcher = {
        matcherType: MatcherTypes.FILE
    };

    protected abstract getCloneType(): string;

    /**
     * 由子类实现具体规范化策略并返回哈希与规范化内容。
     */
    protected abstract computeHash(stmts: Stmt[]): { hash: string; normalizedContent: string };

    /**
     * 默认描述模板；子类可按规则类型覆盖。
     */
    protected getDescription(method: MethodInfo, cloneWith: MethodInfo, _pair?: ClonePair): string {
        return `Code Clone ${this.getCloneType()}: ${formatMethodCloneAnchor(method)} ` +
            `is identical to ${formatMethodCloneTarget(cloneWith)}. ` +
            `(${method.stmtCount} statements)`;
    }

    /**
     * 每轮检测开始时重置状态并解析配置。
     */
    public beforeCheck(): void {
        this.methodsByHash.clear();
        this.collectedMethodKeys.clear();
        this.reportedPairs.clear();
        this.collectedPairs = [];
        this.issues = [];
        this.options = parseRuleOptions(this.rule, METHOD_CLONE_OPTIONS_SCHEMA, DEFAULT_METHOD_CLONE_OPTIONS);
        this.optionsResolved = true;
    }

    public check = (): void => {}

    /**
     * 注册 FILE 级匹配器，驱动方法收集。
     */
    public registerMatchers(): MatcherCallback[] {
        const matchFileCb: MatcherCallback = {
            matcher: this.fileMatcher,
            callback: this.collectMethods
        };
        return [matchFileCb];
    }

    /**
     * 从 ArkFile 收集候选方法并按身份去重后入桶。
     */
    public collectMethods = (arkFile: ArkFile): void => {
        const filePath = arkFile.getFilePath();

        for (const arkClass of arkFile.getClasses()) {
            const className = arkClass.getName();
            if (shouldSkipClass(className)) {
                continue;
            }

            for (const method of arkClass.getMethods()) {
                if (shouldSkipMethod(method.getName())) {
                    continue;
                }

                const methodInfo = this.extractMethodInfo(method, filePath, className);
                if (!methodInfo || methodInfo.stmtCount < this.option("minStmts")) {
                    continue;
                }

                const methodKey = this.getMethodIdentityKey(methodInfo);
                if (this.collectedMethodKeys.has(methodKey)) {
                    continue;
                }

                this.collectedMethodKeys.add(methodKey);
                this.addMethodToHash(methodInfo);
            }
        }
    }

    /**
     * 收尾阶段：先做精确克隆，再按阈值可选做近似克隆，最后按配置决定是否聚合为克隆类。
     */
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

    /**
     * 提取方法元信息与规范化结果；不满足条件时返回 null。
     */
    protected extractMethodInfo(method: ArkMethod, filePath: string, className: string): MethodInfo | null {
        const body = method.getBody();
        if (!body) {
            return null;
        }

        const allStmts = body.getCfg().getStmts();
        if (allStmts.length === 0) {
            return null;
        }

        const stmts = this.filterStatements(allStmts);
        if (stmts.length === 0) {
            return null;
        }

        const { hash, normalizedContent } = this.computeHash(stmts);
        const normalizedTokens = normalizedContent.split("|").filter(token => token.length > 0);

        const minComplexity = this.option("minComplexity");
        if (minComplexity > 0) {
            const distinctTokens = new Set(normalizedContent.split(/\s+|\|/).filter(Boolean)).size;
            if (distinctTokens < minComplexity) {
                return null;
            }
        }

        return {
            method,
            filePath,
            className,
            methodName: method.getName(),
            startLine: method.getLine() ?? 0,
            endLine: getMethodEndLine(method),
            hash,
            normalizedContent,
            normalizedTokens,
            stmtCount: stmts.length
        };
    }

    /**
     * 文本基础规范化工具（供子类复用）。
     */
    protected normalizeBasic(text: string): string {
        return normalizeBasicText(text);
    }

    /**
     * 默认哈希函数（DJB2）。
     */
    protected simpleHash(str: string): string {
        return djb2Hash(str);
    }

    /**
     * 将方法按 hash 分桶，供后续配对。
     */
    protected addMethodToHash(methodInfo: MethodInfo): void {
        appendToBucket(this.methodsByHash, methodInfo.hash, methodInfo);
    }

    /**
     * 从 hash 桶中生成精确克隆对并上报。
     */
    protected findClonePairs(): void {
        for (const pair of collectExactClonePairs(this.methodsByHash)) {
            this.reportClonePair(pair);
        }
    }

    /**
     * 单个克隆对上报入口，包含去重与聚合收集。
     */
    protected reportClonePair(pair: ClonePair): void {
        const pairKey = this.getPairKey(pair);
        if (this.reportedPairs.has(pairKey)) {
            return;
        }
        this.reportedPairs.add(pairKey);
        this.collectedPairs.push(pair);
        this.addIssueReport(pair.method1, pair.method2, pair);
    }

    /**
     * 生成无序克隆对唯一键，避免双向重复。
     */
    protected getPairKey(pair: ClonePair): string {
        return buildPairKey(pair.method1, pair.method2);
    }

    /**
     * 方法身份键：file + class + method + startLine。
     */
    protected getMethodIdentityKey(methodInfo: MethodInfo): string {
        return `${methodInfo.filePath}:${methodInfo.className}.${methodInfo.methodName}:${methodInfo.startLine}`;
    }

    /**
     * 将克隆对转换为 Issue。
     */
    protected addIssueReport(method: MethodInfo, cloneWith: MethodInfo, pair?: ClonePair): void {
        const severity = this.rule?.alert ?? this.metaData.severity;
        const description = this.getDescription(method, cloneWith, pair);

        this.issues.push(createDefects({
            line: method.startLine,
            startCol: 0,
            endCol: method.methodName.length,
            description,
            severity,
            ruleId: this.rule.ruleId,
            filePath: method.filePath,
            ruleDocPath: this.metaData.ruleDocPath,
            methodName: method.methodName
        }));
    }

    /**
     * 将克隆对按并查集聚合为克隆类并上报。
     */
    protected reportCloneClasses(): void {
        const severity = this.rule?.alert ?? this.metaData.severity;
        const cloneClasses = classifyMethodClonePairs(this.collectedPairs);

        for (const cloneClass of cloneClasses) {
            const members = cloneClass.members;
            const anchor = members[0];
            const memberDesc = formatMethodCloneMembers(members);

            const description = `Code Clone ${this.getCloneType()} [Class #${cloneClass.classId}, ${members.length} members]: ${memberDesc}.`;

            this.issues.push(createDefects({
                line: anchor.startLine,
                startCol: 0,
                endCol: anchor.methodName.length,
                description,
                severity,
                ruleId: this.rule.ruleId,
                filePath: anchor.filePath,
                ruleDocPath: this.metaData.ruleDocPath,
                methodName: anchor.methodName
            }));
        }
    }

    /**
     * 惰性读取配置，避免测试直接调用内部方法时出现未初始化状态。
     */
    private getResolvedOptions(): MethodCloneRuleOptions {
        if (!this.optionsResolved) {
            this.options = parseRuleOptions(this.rule, METHOD_CLONE_OPTIONS_SCHEMA, DEFAULT_METHOD_CLONE_OPTIONS);
            this.optionsResolved = true;
        }
        return this.options;
    }

    /**
     * 强类型配置访问入口。
     */
    protected option<K extends keyof MethodCloneRuleOptions>(key: K): MethodCloneRuleOptions[K] {
        return this.getResolvedOptions()[key];
    }

    /**
     * 计算方法规范化 token 多重集 Jaccard 相似度。
     */
    protected computeJaccardSimilarity(method1: MethodInfo, method2: MethodInfo): number {
        if (!method1.tokenMultiset) {
            method1.tokenMultiset = buildTokenMultiset(method1.normalizedTokens);
        }
        if (!method2.tokenMultiset) {
            method2.tokenMultiset = buildTokenMultiset(method2.normalizedTokens);
        }
        return jaccardSimilarityFromMultisets(method1.tokenMultiset, method2.tokenMultiset);
    }

    /**
     * 近似克隆检测：基于长度约束 + 相似度阈值。
     */
    protected findNearMissClones(threshold: number): void {
        const pairs = collectNearMissClonePairs(
            this.methodsByHash,
            threshold,
            (method1, method2) => this.computeJaccardSimilarity(method1, method2)
        );

        for (const pair of pairs) {
            this.reportClonePair(pair);
        }
    }

    /**
     * 是否为纯日志语句（默认委托 shared 工具）。
     */
    protected isLogStatement(stmt: Stmt): boolean {
        return isLogStatementUtil(stmt);
    }

    /**
     * 语句过滤入口；当前只处理 ignoreLogs。
     */
    protected filterStatements(stmts: Stmt[]): Stmt[] {
        if (!this.option("ignoreLogs")) {
            return stmts;
        }
        return stmts.filter(stmt => !this.isLogStatement(stmt));
    }
}
