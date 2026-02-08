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
    stmtCount: number;
}

/**
 * 克隆对信息
 */
export interface ClonePair {
    method1: MethodInfo;
    method2: MethodInfo;
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

    // 存储所有方法信息，按哈希值分组
    protected methodsByHash: Map<string, MethodInfo[]> = new Map();

    // 已报告的克隆对（避免重复报告）
    protected reportedPairs: Set<string> = new Set();

    // 文件匹配器 - 匹配所有文件
    private fileMatcher: FileMatcher = {
        matcherType: MatcherTypes.FILE
    };

    /**
     * 获取克隆类型标识（如 "Type-1", "Type-2"）
     */
    protected abstract getCloneType(): string;

    /**
     * 计算方法的哈希值（子类实现不同的规范化策略）
     */
    protected abstract computeHash(stmts: Stmt[]): string;

    /**
     * 生成问题描述（子类可覆盖）
     */
    protected getDescription(method: MethodInfo, cloneWith: MethodInfo): string {
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

        // 计算哈希值（由子类实现具体算法）
        const hash = this.computeHash(stmts);
        
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
            // 如果有多个方法具有相同的哈希值，它们是克隆
            if (methods.length >= 2) {
                // 两两配对
                for (let i = 0; i < methods.length; i++) {
                    for (let j = i + 1; j < methods.length; j++) {
                        const pair: ClonePair = {
                            method1: methods[i],
                            method2: methods[j]
                        };
                        this.reportClonePair(pair);
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

        // 为第一个方法生成报告
        this.addIssueReport(pair.method1, pair.method2);
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
    protected addIssueReport(method: MethodInfo, cloneWith: MethodInfo): void {
        const severity = this.rule?.alert ?? this.metaData.severity;
        const description = this.getDescription(method, cloneWith);

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
