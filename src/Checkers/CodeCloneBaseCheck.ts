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
    djb2Hash,
    getMethodEndLine,
    getRuleOption,
    isLogStatement as isLogStatementUtil,
    normalizeBasic as normalizeBasicText,
    shouldSkipClass,
    shouldSkipMethod
} from "./utils";
import { UnionFind } from "./FragmentDetection";

/**
 * 方法信息，用于克隆检测
 */
export interface MethodInfo {
    method: ArkMethod;
    filePath: string;
    className: string;
    methodName: string;
    startLine: number;
    endLine: number;
    hash: string;  // 计算后的哈希值
    normalizedContent: string;  // 规范化后的内容，用于哈希碰撞验证
    stmtCount: number;
}

/**
 * 克隆对信息
 */
export interface ClonePair {
    method1: MethodInfo;
    method2: MethodInfo;
    /** 相似度（1.0 = 完全相同，< 1.0 = 近似克隆） */
    similarity?: number;
}

/**
 * Code Clone 检测基类
 * 
 * 提供克隆检测的通用逻辑：
 * - 方法收集
 * - 哈希分组
 * - 克隆对查找
 * - 问题报告
 * 
 * 子类需要实现：
 * - metaData: 规则元数据
 * - getCloneType(): 克隆类型标识
 * - computeHash(): 计算方法的哈希值
 * - getDescription(): 生成问题描述
 */
export abstract class CodeCloneBaseCheck implements AdviceChecker {
    abstract readonly metaData: BaseMetaData;
    public rule: Rule;
    public issues: IssueReport[] = [];
    public arkFiles: ArkFile[] = [];

    // 最小方法语句数阈值
    protected readonly DEFAULT_MIN_STMTS = 5;

    // 最小复杂度阈值（不同规范化 token 数），0 = 禁用
    protected readonly DEFAULT_MIN_COMPLEXITY = 0;

    // 近似克隆：相似度阈值（1.0 = 仅报告完全相同，0.8 = 报告 80% 以上相似）
    protected readonly DEFAULT_SIMILARITY_THRESHOLD = 1.0;

    // 是否启用克隆类分组
    protected readonly DEFAULT_ENABLE_CLONE_CLASSES = false;

    // 存储所有方法信息，按哈希值分组
    protected methodsByHash: Map<string, MethodInfo[]> = new Map();

    // 已报告的克隆对（避免重复报告）
    protected reportedPairs: Set<string> = new Set();

    // 克隆类模式：收集所有克隆对用于分组
    protected collectedPairs: ClonePair[] = [];

    // 文件匹配器 - 匹配所有文件
    private fileMatcher: FileMatcher = {
        matcherType: MatcherTypes.FILE
    };

    /**
     * 获取克隆类型标识（如 "Type-1", "Type-2"）
     */
    protected abstract getCloneType(): string;

    /**
     * 计算方法的哈希值和规范化内容（子类实现不同的规范化策略）
     * 返回 { hash, normalizedContent } 用于哈希碰撞验证
     */
    protected abstract computeHash(stmts: Stmt[]): { hash: string; normalizedContent: string };

    /**
     * 生成问题描述（子类可覆盖）
     */
    protected getDescription(method: MethodInfo, cloneWith: MethodInfo, pair?: ClonePair): string {
        const cloneFileName = cloneWith.filePath.split('/').pop() ?? cloneWith.filePath;
        return `Code Clone ${this.getCloneType()}: Method '${method.methodName}' (lines ${method.startLine}-${method.endLine}) ` +
            `is identical to '${cloneWith.className}.${cloneWith.methodName}' in ${cloneFileName}:${cloneWith.startLine}-${cloneWith.endLine}. ` +
            `(${method.stmtCount} statements)`;
    }

    /**
     * 检测前初始化
     */
    public beforeCheck(): void {
        this.methodsByHash.clear();
        this.reportedPairs.clear();
        this.collectedPairs = [];
        this.issues = [];
    }

    /**
     * 空的 check 方法（实际检测在 collectMethods 和 afterCheck 中完成）
     */
    public check = (): void => {}

    public registerMatchers(): MatcherCallback[] {
        const matchFileCb: MatcherCallback = {
            matcher: this.fileMatcher,
            callback: this.collectMethods
        };
        return [matchFileCb];
    }

    /**
     * 收集文件中的所有方法
     */
    public collectMethods = (arkFile: ArkFile) => {
        const filePath = arkFile.getFilePath();

        for (const arkClass of arkFile.getClasses()) {
            const className = arkClass.getName();

            // 跳过默认类
            if (shouldSkipClass(className)) {
                continue;
            }

            for (const method of arkClass.getMethods()) {
                const methodName = method.getName();

                // 跳过默认方法、静态初始化、构造函数
                if (shouldSkipMethod(methodName)) {
                    continue;
                }

                const methodInfo = this.extractMethodInfo(method, filePath, className);

                if (methodInfo) {
                    if (methodInfo.stmtCount >= this.getMinStmts()) {
                        this.addMethodToHash(methodInfo);
                    }
                }
            }
        }
    }

    /**
     * 检测完成后调用，查找克隆对
     */
    public afterCheck(): void {
        this.findClonePairs();
        // 近似克隆检测（仅当 similarityThreshold < 1.0 时启用）
        const threshold = this.getSimilarityThreshold();
        if (threshold < 1.0) {
            this.findNearMissClones(threshold);
        }

        // 克隆类分组模式：将逐对报告替换为分组报告
        if (this.getEnableCloneClasses() && this.collectedPairs.length > 0) {
            this.issues = [];
            this.reportCloneClasses();
        }
    }

    /**
     * 提取方法信息
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

        // 过滤日志语句（如果配置了 ignoreLogs: true）
        const stmts = this.filterStatements(allStmts);
        if (stmts.length === 0) {
            return null;  // 过滤后没有语句了
        }

        // 计算哈希值和规范化内容（由子类实现具体算法）
        const { hash, normalizedContent } = this.computeHash(stmts);

        // 复杂度门控：如果不同 token 数量低于阈值，则跳过
        const minComplexity = this.getMinComplexity();
        if (minComplexity > 0) {
            const distinctTokens = new Set(normalizedContent.split(/\s+|\|/).filter(t => t.length > 0)).size;
            if (distinctTokens < minComplexity) {
                return null;
            }
        }
        
        // 获取起止行号（使用原始语句列表，保留完整范围）
        const startLine = method.getLine() ?? 0;
        const endLine = getMethodEndLine(method);

        return {
            method,
            filePath,
            className,
            methodName: method.getName(),
            startLine,
            endLine,
            hash,
            normalizedContent,
            stmtCount: stmts.length  // 使用过滤后的语句数
        };
    }

    /**
     * 基础规范化：去除位置相关信息
     */
    protected normalizeBasic(text: string): string {
        return normalizeBasicText(text);
    }

    /**
     * DJB2 哈希函数
     */
    protected simpleHash(str: string): string {
        return djb2Hash(str);
    }

    /**
     * 获取方法结束行号
     */
    protected getMethodEndLine(method: ArkMethod): number {
        return getMethodEndLine(method);
    }

    /**
     * 将方法添加到哈希表
     */
    protected addMethodToHash(methodInfo: MethodInfo): void {
        const existing = this.methodsByHash.get(methodInfo.hash);
        if (existing) {
            existing.push(methodInfo);
        } else {
            this.methodsByHash.set(methodInfo.hash, [methodInfo]);
        }
    }

    /**
     * 查找克隆对并上报
     */
    protected findClonePairs(): void {
        for (const methods of this.methodsByHash.values()) {
            // 如果有多个方法具有相同的哈希值，进行碰撞验证后配对
            if (methods.length >= 2) {
                // 按 normalizedContent 分组，验证哈希碰撞
                const contentGroups = new Map<string, MethodInfo[]>();
                for (const m of methods) {
                    const existing = contentGroups.get(m.normalizedContent);
                    if (existing) {
                        existing.push(m);
                    } else {
                        contentGroups.set(m.normalizedContent, [m]);
                    }
                }

                // 只有 normalizedContent 完全相同的方法才是真正的克隆
                for (const group of contentGroups.values()) {
                    if (group.length < 2) {
                        continue;  // 哈希碰撞，跳过
                    }
                    for (let i = 0; i < group.length; i++) {
                        for (let j = i + 1; j < group.length; j++) {
                            const pair: ClonePair = {
                                method1: group[i],
                                method2: group[j]
                            };
                            this.reportClonePair(pair);
                        }
                    }
                }
            }
        }
    }

    /**
     * 上报克隆对
     */
    protected reportClonePair(pair: ClonePair): void {
        // 生成唯一标识，避免重复报告
        const pairKey = this.getPairKey(pair);
        if (this.reportedPairs.has(pairKey)) {
            return;
        }
        this.reportedPairs.add(pairKey);

        // 收集克隆对（用于后续克隆类分组）
        this.collectedPairs.push(pair);

        // 为第一个方法生成报告
        this.addIssueReport(pair.method1, pair.method2, pair);
    }

    /**
     * 生成克隆对的唯一标识
     */
    protected getPairKey(pair: ClonePair): string {
        const key1 = `${pair.method1.filePath}:${pair.method1.methodName}`;
        const key2 = `${pair.method2.filePath}:${pair.method2.methodName}`;
        // 排序确保相同对生成相同的 key
        return [key1, key2].sort().join('|');
    }

    /**
     * 添加问题报告
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
     * 将收集到的克隆对分组为克隆类并上报
     *
     * 使用 Union-Find 将共享克隆关系的方法分为等价类。
     * 每个等价类作为一条克隆类报告。
     */
    protected reportCloneClasses(): void {
        const uf = new UnionFind();
        const methodByKey = new Map<string, MethodInfo>();

        const getMethodKey = (m: MethodInfo): string =>
            `${m.filePath}:${m.className}.${m.methodName}:${m.startLine}`;

        for (const pair of this.collectedPairs) {
            const key1 = getMethodKey(pair.method1);
            const key2 = getMethodKey(pair.method2);
            methodByKey.set(key1, pair.method1);
            methodByKey.set(key2, pair.method2);
            uf.find(key1);
            uf.find(key2);
            uf.union(key1, key2);
        }

        const groups = uf.getGroups();
        const severity = this.rule?.alert ?? this.metaData.severity;
        let classId = 0;

        for (const keys of groups.values()) {
            if (keys.length < 2) continue;
            classId++;

            const members = keys
                .map(k => methodByKey.get(k))
                .filter((m): m is MethodInfo => m !== undefined)
                .sort((a, b) => {
                    if (a.filePath !== b.filePath) return a.filePath.localeCompare(b.filePath);
                    return a.startLine - b.startLine;
                });

            const anchor = members[0];
            const memberDesc = members.map(m => {
                const fileName = m.filePath.split('/').pop() ?? m.filePath;
                return `${m.className}.${m.methodName}() in ${fileName}:${m.startLine}-${m.endLine}`;
            }).join('; ');

            const description = `Code Clone ${this.getCloneType()} [Class #${classId}, ${members.length} members]: ${memberDesc}.`;

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
     * 从配置中获取最小语句数阈值
     */
    protected getMinStmts(): number {
        const option = getRuleOption(this.rule, { minStmts: this.DEFAULT_MIN_STMTS });
        return option.minStmts;
    }

    /**
     * 从配置中获取是否忽略字面量差异
     * 
     * 注意：此选项默认关闭，因为开启后可能产生误报
     * 详见 test/sample/CodeClone/README.md 中的说明
     * 
     * 使用方式：在 ruleConfig.json 中配置
     * "@extrulesproject/code-clone-type2-check": ["error", { "ignoreLiterals": true }]
     */
    protected getIgnoreLiterals(): boolean {
        const option = getRuleOption(this.rule, { ignoreLiterals: false });
        return option.ignoreLiterals;
    }

    /**
     * 从配置中获取是否忽略日志语句
     * 
     * 日志语句（console.log、hilog、Logger 等）通常只是调试信息，
     * 不影响业务逻辑，因此默认跳过以减少噪声。
     * 
     * 使用方式：在 ruleConfig.json 中配置
     * "@extrulesproject/code-clone-type1-check": ["error", { "ignoreLogs": false }]
     * 
     * 默认值：true（开启日志过滤）
     */
    protected getIgnoreLogs(): boolean {
        const option = getRuleOption(this.rule, { ignoreLogs: true });
        return option.ignoreLogs;
    }

    /**
     * 从配置中获取是否忽略类型注解
     *
     * 类型注解（: string, : number, as Type 等）在 Type-1/Type-2 检测中
     * 可能导致仅类型不同的方法被认为不同。开启后可减少此类误报。
     *
     * 默认值：false（不忽略）
     */
    protected getIgnoreTypes(): boolean {
        const option = getRuleOption(this.rule, { ignoreTypes: false });
        return option.ignoreTypes;
    }

    /**
     * 从配置中获取是否忽略装饰器
     *
     * 装饰器（@Component, @State 等）在 ArkTS 中广泛使用，
     * 可能导致仅装饰器不同的方法被认为不同。开启后可减少此类误报。
     *
     * 默认值：false（不忽略）
     */
    protected getIgnoreDecorators(): boolean {
        const option = getRuleOption(this.rule, { ignoreDecorators: false });
        return option.ignoreDecorators;
    }

    /**
     * 从配置中获取最小复杂度阈值
     *
     * 复杂度以方法规范化内容中不同 token 的数量衡量。
     * 低于阈值的方法被认为过于简单（如纯 getter/setter），将被跳过。
     *
     * 默认值：0（禁用，不过滤任何方法）
     */
    protected getMinComplexity(): number {
        const option = getRuleOption(this.rule, { minComplexity: this.DEFAULT_MIN_COMPLEXITY });
        return option.minComplexity;
    }

    /**
     * 从配置中获取近似克隆相似度阈值
     *
     * 设为 1.0 时仅报告完全相同的克隆（默认行为）。
     * 设为 0.8 时，还会报告 80% 以上相似的方法对。
     *
     * 默认值：1.0（禁用近似克隆检测，保持向后兼容）
     */
    protected getSimilarityThreshold(): number {
        const option = getRuleOption(this.rule, { similarityThreshold: this.DEFAULT_SIMILARITY_THRESHOLD });
        return option.similarityThreshold;
    }

    /**
     * 从配置中获取是否启用克隆类分组
     *
     * 默认值：false（不启用）
     */
    protected getEnableCloneClasses(): boolean {
        const option = getRuleOption(this.rule, { enableCloneClasses: this.DEFAULT_ENABLE_CLONE_CLASSES });
        return option.enableCloneClasses;
    }

    /**
     * 计算两个规范化内容的 Jaccard 相似度
     *
     * 将内容按 '|' 分割为 token 多重集合，
     * 计算 Σmin(count1, count2) / Σmax(count1, count2)。
     *
     * @param content1 规范化内容 1
     * @param content2 规范化内容 2
     * @returns 相似度 [0, 1]
     */
    protected computeJaccardSimilarity(content1: string, content2: string): number {
        const buildMultiset = (content: string): Map<string, number> => {
            const multiset = new Map<string, number>();
            for (const token of content.split('|')) {
                if (token.length === 0) continue;
                multiset.set(token, (multiset.get(token) ?? 0) + 1);
            }
            return multiset;
        };

        const set1 = buildMultiset(content1);
        const set2 = buildMultiset(content2);

        // 收集所有 key
        const allKeys = new Set([...set1.keys(), ...set2.keys()]);

        let sumMin = 0;
        let sumMax = 0;
        for (const key of allKeys) {
            const c1 = set1.get(key) ?? 0;
            const c2 = set2.get(key) ?? 0;
            sumMin += Math.min(c1, c2);
            sumMax += Math.max(c1, c2);
        }

        return sumMax === 0 ? 0 : sumMin / sumMax;
    }

    /**
     * 查找近似克隆对
     *
     * 收集所有方法，按语句数进行长度比率分桶（±20%），
     * 对桶内的方法对计算 Jaccard 相似度，
     * 相似度 ≥ threshold 且 < 1.0 的对报告为近似克隆。
     *
     * @param threshold 相似度阈值
     */
    protected findNearMissClones(threshold: number): void {
        // 收集所有方法（扁平化）
        const allMethods: MethodInfo[] = [];
        for (const methods of this.methodsByHash.values()) {
            allMethods.push(...methods);
        }

        if (allMethods.length < 2) {
            return;
        }

        // 按语句数排序，方便长度比率分桶
        allMethods.sort((a, b) => a.stmtCount - b.stmtCount);

        // 长度比率范围：0.8 ~ 1.25（即 1/1.25 ~ 1.25）
        const RATIO_UPPER = 1.25;

        for (let i = 0; i < allMethods.length; i++) {
            for (let j = i + 1; j < allMethods.length; j++) {
                const mi = allMethods[i];
                const mj = allMethods[j];

                // 长度比率过滤（已按 stmtCount 排序，mj >= mi）
                if (mi.stmtCount > 0 && mj.stmtCount / mi.stmtCount > RATIO_UPPER) {
                    break; // 后续的 j 只会更大，直接跳出
                }

                // 跳过完全相同的对（已被 findClonePairs 报告）
                if (mi.normalizedContent === mj.normalizedContent) {
                    continue;
                }

                // 计算 Jaccard 相似度
                const similarity = this.computeJaccardSimilarity(mi.normalizedContent, mj.normalizedContent);

                if (similarity >= threshold) {
                    const pair: ClonePair = {
                        method1: mi,
                        method2: mj,
                        similarity
                    };
                    this.reportClonePair(pair);
                }
            }
        }
    }

    /**
     * 判断语句是否为纯日志语句
     * 
     * 只过滤"纯日志语句"，即整行代码只有日志调用，没有其他业务逻辑。
     * 如果日志调用嵌在复杂表达式中（如 doSomething() && console.log("done")），
     * 则不跳过该语句，以避免漏掉业务逻辑。
     * 
     * 支持的日志模式：
     * - console.* (console.log, console.info, console.warn, console.error, console.debug)
     * - hilog.* (HarmonyOS 系统日志)
     * - Logger.* (项目自定义封装)
     */
    protected isLogStatement(stmt: Stmt): boolean {
        return isLogStatementUtil(stmt);
    }

    /**
     * 过滤语句列表，移除日志语句
     * 
     * 如果配置了 ignoreLogs: true（默认），则过滤掉纯日志语句
     */
    protected filterStatements(stmts: Stmt[]): Stmt[] {
        if (!this.getIgnoreLogs()) {
            return stmts;  // 不过滤
        }
        
        return stmts.filter(stmt => !this.isLogStatement(stmt));
    }
}
