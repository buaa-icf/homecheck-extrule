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
    Defects, 
    MatcherCallback, 
    IssueReport,
    FileMatcher,
    MatcherTypes,
    AdviceChecker
} from "homecheck";

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
        console.log(`[CodeClone] beforeCheck called for ${this.getCloneType()}`);
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
        console.log(`[CodeClone] Scanning file: ${filePath}`);
        
        for (const arkClass of arkFile.getClasses()) {
            const className = arkClass.getName();
            
            // 跳过默认类
            if (className.startsWith('%')) {
                continue;
            }

            for (const method of arkClass.getMethods()) {
                const methodName = method.getName();
                
                // 跳过默认方法、静态初始化、构造函数
                if (methodName.startsWith('%') || methodName === 'constructor') {
                    continue;
                }

                const methodInfo = this.extractMethodInfo(method, filePath, className);
                
                if (methodInfo) {
                    console.log(`[CodeClone] Found method: ${className}.${methodName}, stmts=${methodInfo.stmtCount}, minRequired=${this.getMinStmts()}`);
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
        console.log(`[CodeClone] afterCheck called. Total unique hashes: ${this.methodsByHash.size}`);
        for (const [hash, methods] of this.methodsByHash) {
            if (methods.length >= 2) {
                console.log(`[CodeClone] Hash ${hash}: ${methods.length} methods (potential clone)`);
            }
        }
        this.findClonePairs();
        console.log(`[CodeClone] Total issues found: ${this.issues.length}`);
    }

    /**
     * 提取方法信息
     */
    protected extractMethodInfo(method: ArkMethod, filePath: string, className: string): MethodInfo | null {
        const body = method.getBody();
        if (!body) {
            return null;
        }

        const stmts = body.getCfg().getStmts();
        if (stmts.length === 0) {
            return null;
        }

        // 计算哈希值（由子类实现具体算法）
        const hash = this.computeHash(stmts);
        
        // 获取起止行号
        const startLine = method.getLine() ?? 0;
        const endLine = this.getMethodEndLine(stmts, startLine);

        return {
            method,
            filePath,
            className,
            methodName: method.getName(),
            startLine,
            endLine,
            hash,
            stmtCount: stmts.length
        };
    }

    /**
     * 基础规范化：去除位置相关信息
     */
    protected normalizeBasic(text: string): string {
        // 去除多余空白
        text = text.replace(/\s+/g, ' ').trim();
        
        // 去除文件路径信息
        text = text.replace(/@[^:\s]+\.[a-z]+:/gi, '@FILE:');
        
        // 规范化 this 引用中的类名
        text = text.replace(/this: @FILE: \w+/g, 'this: @FILE: CLASS');
        
        // 规范化匿名类引用
        text = text.replace(/%AC\d+/g, '%AC');
        
        return text;
    }

    /**
     * DJB2 哈希函数
     */
    protected simpleHash(str: string): string {
        let hash = 0;
        for (let i = 0; i < str.length; i++) {
            const char = str.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash = hash & hash; // Convert to 32bit integer
        }
        return hash.toString(16);
    }

    /**
     * 获取方法结束行号
     */
    protected getMethodEndLine(stmts: Stmt[], startLine: number): number {
        let maxLine = startLine;
        for (const stmt of stmts) {
            const pos = stmt.getOriginPositionInfo();
            if (pos) {
                const line = pos.getLineNo();
                if (line > maxLine) {
                    maxLine = line;
                }
            }
        }
        return maxLine;
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
        for (const [hash, methods] of this.methodsByHash) {
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

        const defects = new Defects(
            method.startLine,
            0,  // startCol
            method.methodName.length,  // endCol
            description,
            severity,
            this.rule.ruleId,
            method.filePath,
            this.metaData.ruleDocPath,
            true,   // disabled
            false,  // checked
            false,  // fixable
            method.methodName,  // methodName
            true    // showIgnoreIcon
        );

        this.issues.push(new IssueReport(defects, undefined));
    }

    /**
     * 从配置中获取最小语句数阈值
     */
    protected getMinStmts(): number {
        if (this.rule && this.rule.option && this.rule.option.length > 0) {
            const firstOption = this.rule.option[0] as any;
            if (typeof firstOption.minStmts === 'number') {
                return firstOption.minStmts;
            }
        }
        return this.DEFAULT_MIN_STMTS;
    }
}
