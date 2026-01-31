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
    ruleDocPath: "docs/code-clone-type2-check.md",
    description: 'Code Clone Type-2 detected: Structurally identical code with renamed identifiers.'
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
    normalizedHash: string;  // 规范化后的哈希值（标识符已替换）
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
 * Code Clone Type-2 检测规则
 * 
 * Type-2 克隆：结构相同但标识符（变量名、函数名）不同的代码
 * 
 * 检测算法：
 * 1. 遍历所有文件中的方法
 * 2. 对每个方法进行"标识符规范化"（变量名→VAR_1, 函数名→FUNC_1）
 * 3. 计算规范化后的哈希值
 * 4. 比较哈希值，找出结构相同的方法对
 * 5. 上报克隆对
 */
export class CodeCloneType2Check implements AdviceChecker {
    readonly metaData: BaseMetaData = gMetaData;
    public rule: Rule;
    public issues: IssueReport[] = [];
    public arkFiles: ArkFile[] = [];

    // 最小方法语句数阈值
    private readonly DEFAULT_MIN_STMTS = 5;

    // 存储所有方法信息，按哈希值分组
    private methodsByHash: Map<string, MethodInfo[]> = new Map();

    // 已报告的克隆对（避免重复报告）
    private reportedPairs: Set<string> = new Set();

    // 文件匹配器 - 匹配所有文件
    private fileMatcher: FileMatcher = {
        matcherType: MatcherTypes.FILE
    };

    /**
     * 检测前初始化
     */
    public beforeCheck(): void {
        this.methodsByHash.clear();
        this.reportedPairs.clear();
        this.issues = [];
    }

    /**
     * 空的 check 方法
     */
    public check = (): void => {
    }

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
            
            if (className.startsWith('%')) {
                continue;
            }

            for (const method of arkClass.getMethods()) {
                const methodName = method.getName();
                
                // 跳过默认方法、构造函数（构造函数结构通常相似，不算有意义的克隆）
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

        // 计算规范化后的哈希值（包含标识符规范化）
        const normalizedHash = this.computeNormalizedHash(stmts);
        
        const startLine = method.getLine() ?? 0;
        const endLine = this.getMethodEndLine(stmts, startLine);

        return {
            method,
            filePath,
            className,
            methodName: method.getName(),
            startLine,
            endLine,
            normalizedHash,
            stmtCount: stmts.length
        };
    }

    /**
     * 计算规范化后的哈希值
     * Type-2 需要将标识符替换为占位符
     */
    private computeNormalizedHash(stmts: Stmt[]): string {
        // 用于追踪已见过的标识符
        const identifierMap = new Map<string, string>();
        let varCounter = 0;
        let funcCounter = 0;

        const stmtStrings = stmts.map(stmt => {
            let text = stmt.toString();
            // 先做基础规范化（去除路径、类名）
            text = this.normalizeBasic(text);
            // 再做标识符规范化
            text = this.normalizeIdentifiers(text, identifierMap, () => ++varCounter, () => ++funcCounter);
            return text;
        });
        
        const combined = stmtStrings.join('|');
        return this.simpleHash(combined);
    }

    /**
     * 基础规范化（与 Type1 相同）
     */
    private normalizeBasic(text: string): string {
        text = text.replace(/\s+/g, ' ').trim();
        text = text.replace(/@[^:\s]+\.[a-z]+:/gi, '@FILE:');
        text = text.replace(/this: @FILE: \w+/g, 'this: @FILE: CLASS');
        text = text.replace(/%AC\d+/g, '%AC');
        return text;
    }

    /**
     * 标识符规范化
     * 将变量名、函数名替换为 VAR_1, VAR_2, FUNC_1 等
     */
    private normalizeIdentifiers(
        text: string, 
        identifierMap: Map<string, string>,
        nextVar: () => number,
        nextFunc: () => number
    ): string {
        // 匹配标识符模式：字母开头，后跟字母、数字、下划线
        // 排除关键字和已知类型
        const keywords = new Set([
            'let', 'const', 'var', 'function', 'return', 'if', 'else', 'for', 'while',
            'true', 'false', 'null', 'undefined', 'this', 'new', 'class', 'extends',
            'number', 'string', 'boolean', 'void', 'any', 'object',
            'length', 'push', 'pop', 'map', 'filter', 'forEach', 'indexOf',
            'console', 'log', 'toFixed', 'trim', 'toString',
            'parameter0', 'parameter1', 'parameter2'  // ArkAnalyzer 的参数占位符
        ]);

        // 使用正则匹配标识符
        const identifierPattern = /\b([a-zA-Z_][a-zA-Z0-9_]*)\b/g;
        
        return text.replace(identifierPattern, (match) => {
            // 跳过关键字和短标识符
            if (keywords.has(match.toLowerCase()) || match.length <= 1) {
                return match;
            }
            
            // 跳过全大写的常量（如 CLASS, FILE）
            if (match === match.toUpperCase() && match.length > 1) {
                return match;
            }

            // 检查是否已经映射过
            if (identifierMap.has(match)) {
                return identifierMap.get(match)!;
            }

            // 生成新的规范化名称
            // 简单策略：所有标识符统一用 ID_N
            const normalized = `ID_${identifierMap.size + 1}`;
            identifierMap.set(match, normalized);
            return normalized;
        });
    }

    /**
     * 简单的字符串哈希函数
     */
    private simpleHash(str: string): string {
        let hash = 0;
        for (let i = 0; i < str.length; i++) {
            const char = str.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash = hash & hash;
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
        const existing = this.methodsByHash.get(methodInfo.normalizedHash);
        if (existing) {
            existing.push(methodInfo);
        } else {
            this.methodsByHash.set(methodInfo.normalizedHash, [methodInfo]);
        }
    }

    /**
     * 查找克隆对并上报
     */
    private findClonePairs(): void {
        for (const [hash, methods] of this.methodsByHash) {
            if (methods.length >= 2) {
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
        const pairKey = this.getPairKey(pair);
        if (this.reportedPairs.has(pairKey)) {
            return;
        }
        this.reportedPairs.add(pairKey);

        this.addIssueReport(pair.method1, pair.method2);
    }

    /**
     * 生成克隆对的唯一标识
     */
    private getPairKey(pair: ClonePair): string {
        const key1 = `${pair.method1.filePath}:${pair.method1.methodName}`;
        const key2 = `${pair.method2.filePath}:${pair.method2.methodName}`;
        return [key1, key2].sort().join('|');
    }

    /**
     * 添加问题报告
     */
    private addIssueReport(method: MethodInfo, cloneWith: MethodInfo): void {
        const severity = this.rule?.alert ?? this.metaData.severity;
        
        const cloneFileName = cloneWith.filePath.split('/').pop() ?? cloneWith.filePath;
        
        const description = `Code Clone Type-2: Method '${method.methodName}' (lines ${method.startLine}-${method.endLine}) ` +
            `is structurally identical to '${cloneWith.className}.${cloneWith.methodName}' in ${cloneFileName}:${cloneWith.startLine}-${cloneWith.endLine}. ` +
            `(${method.stmtCount} statements, renamed identifiers)`;

        const defects = new Defects(
            method.startLine,
            0,
            method.methodName.length,
            description,
            severity,
            this.rule.ruleId,
            method.filePath,
            this.metaData.ruleDocPath,
            true,
            false,
            false,
            true
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
