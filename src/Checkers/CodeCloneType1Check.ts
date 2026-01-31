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

const gMetaData: BaseMetaData = {
    severity: 2,
    ruleDocPath: "docs/code-clone-type1-check.md",
    description: 'Code Clone Type-1 detected: Identical code fragments found.'
};

/**
 * 方法信息，用于克隆检测
 */
interface MethodInfo {
    method: ArkMethod;
    filePath: string;
    className: string;
    methodName: string;
    startLine: number;
    endLine: number;
    stmtHash: string;  // 语句序列的哈希值
    stmtCount: number;
}

/**
 * 克隆对信息
 */
interface ClonePair {
    method1: MethodInfo;
    method2: MethodInfo;
}

/**
 * Code Clone Type-1 检测规则
 * 
 * Type-1 克隆：完全相同的代码片段（仅空白和注释可以不同）
 * 
 * 检测算法：
 * 1. 遍历所有文件中的方法
 * 2. 对每个方法计算语句序列的哈希值
 * 3. 比较哈希值，找出相同的方法对
 * 4. 上报克隆对
 */
export class CodeCloneType1Check implements AdviceChecker {
    readonly metaData: BaseMetaData = gMetaData;
    public rule: Rule;
    public issues: IssueReport[] = [];
    public arkFiles: ArkFile[] = [];

    // 最小方法语句数阈值（太短的方法不检测）
    private readonly DEFAULT_MIN_STMTS = 5;

    /**
     * 检测前初始化
     */
    public beforeCheck(): void {
        this.methodsByHash.clear();
        this.reportedPairs.clear();
        this.issues = [];
    }

    /**
     * 空的 check 方法（实际检测在 collectMethods 中完成）
     */
    public check = (): void => {
        // 实际的检测逻辑在 collectMethods 和 afterCheck 中
    }

    // 存储所有方法信息，按哈希值分组
    private methodsByHash: Map<string, MethodInfo[]> = new Map();

    // 已报告的克隆对（避免重复报告）
    private reportedPairs: Set<string> = new Set();

    // 文件匹配器 - 匹配所有文件
    private fileMatcher: FileMatcher = {
        matcherType: MatcherTypes.FILE
    };

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
                
                if (methodInfo && methodInfo.stmtCount >= this.getMinStmts()) {
                    this.addMethodToHash(methodInfo);
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
    private extractMethodInfo(method: ArkMethod, filePath: string, className: string): MethodInfo | null {
        const body = method.getBody();
        if (!body) {
            return null;
        }

        const stmts = body.getCfg().getStmts();
        if (stmts.length === 0) {
            return null;
        }

        // 计算语句序列的哈希值
        const stmtHash = this.computeStmtHash(stmts);
        
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
            stmtHash,
            stmtCount: stmts.length
        };
    }

    /**
     * 计算语句序列的哈希值
     * Type-1 克隆要求完全相同，所以直接用语句的字符串表示
     */
    private computeStmtHash(stmts: Stmt[]): string {
        // 将所有语句转换为规范化的字符串表示
        const stmtStrings = stmts.map(stmt => {
            let text = stmt.toString();
            // 规范化处理
            text = this.normalizeStmtText(text);
            return text;
        });
        
        // 连接所有语句并计算简单哈希
        const combined = stmtStrings.join('|');
        return this.simpleHash(combined);
    }

    /**
     * 规范化语句文本，去除位置相关信息
     */
    private normalizeStmtText(text: string): string {
        // 去除多余空白
        text = text.replace(/\s+/g, ' ').trim();
        
        // 去除文件路径信息（如 @path/to/file.ets: 或 @CodeClone/ets/FileA.ets:）
        text = text.replace(/@[^:\s]+\.[a-z]+:/gi, '@FILE:');
        
        // 规范化 this 引用中的类名（如 "this: @FILE: PageA" -> "this: @FILE: CLASS"）
        text = text.replace(/this: @FILE: \w+/g, 'this: @FILE: CLASS');
        
        // 规范化匿名类引用（如 %AC0, %AC1）
        text = text.replace(/%AC\d+/g, '%AC');
        
        return text;
    }

    /**
     * 简单的字符串哈希函数
     */
    private simpleHash(str: string): string {
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
    private getMethodEndLine(stmts: Stmt[], startLine: number): number {
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
    private addMethodToHash(methodInfo: MethodInfo): void {
        const existing = this.methodsByHash.get(methodInfo.stmtHash);
        if (existing) {
            existing.push(methodInfo);
        } else {
            this.methodsByHash.set(methodInfo.stmtHash, [methodInfo]);
        }
    }

    /**
     * 查找克隆对并上报
     */
    private findClonePairs(): void {
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
    private reportClonePair(pair: ClonePair): void {
        // 生成唯一标识，避免重复报告
        const pairKey = this.getPairKey(pair);
        if (this.reportedPairs.has(pairKey)) {
            return;
        }
        this.reportedPairs.add(pairKey);

        // 为第一个方法生成报告
        this.addIssueReport(pair.method1, pair.method2);
        
        // 为第二个方法也生成报告（可选，取决于需求）
        // this.addIssueReport(pair.method2, pair.method1);
    }

    /**
     * 生成克隆对的唯一标识
     */
    private getPairKey(pair: ClonePair): string {
        const key1 = `${pair.method1.filePath}:${pair.method1.methodName}`;
        const key2 = `${pair.method2.filePath}:${pair.method2.methodName}`;
        // 排序确保相同对生成相同的 key
        return [key1, key2].sort().join('|');
    }

    /**
     * 添加问题报告
     */
    private addIssueReport(method: MethodInfo, cloneWith: MethodInfo): void {
        const severity = this.rule?.alert ?? this.metaData.severity;
        
        // 获取克隆文件的相对信息
        const cloneFileName = cloneWith.filePath.split('/').pop() ?? cloneWith.filePath;
        
        // 构建描述信息
        const description = `Code Clone Type-1: Method '${method.methodName}' (lines ${method.startLine}-${method.endLine}) ` +
            `is identical to '${cloneWith.className}.${cloneWith.methodName}' in ${cloneFileName}:${cloneWith.startLine}-${cloneWith.endLine}. ` +
            `(${method.stmtCount} statements)`;

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
    private getMinStmts(): number {
        if (this.rule && this.rule.option && this.rule.option.length > 0) {
            const firstOption = this.rule.option[0] as any;
            if (typeof firstOption.minStmts === 'number') {
                return firstOption.minStmts;
            }
        }
        return this.DEFAULT_MIN_STMTS;
    }
}
