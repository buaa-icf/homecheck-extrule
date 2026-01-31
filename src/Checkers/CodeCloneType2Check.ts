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

import { Stmt } from "arkanalyzer";
import { BaseMetaData } from "homecheck";
import { CodeCloneBaseCheck, MethodInfo } from "./CodeCloneBaseCheck";

const gMetaData: BaseMetaData = {
    severity: 2,
    ruleDocPath: "docs/code-clone-type2-check.md",
    description: 'Code Clone Type-2 detected: Structurally identical code with renamed identifiers.'
};

/**
 * Code Clone Type-2 检测规则
 * 
 * Type-2 克隆：结构相同但标识符（变量名、函数名）不同的代码
 * 
 * 检测算法：
 * 1. 遍历所有文件中的方法
 * 2. 对每个方法进行"标识符规范化"（变量名→ID_1, ID_2 等）
 * 3. 计算规范化后的哈希值
 * 4. 比较哈希值，找出结构相同的方法对
 * 5. 上报克隆对
 */
export class CodeCloneType2Check extends CodeCloneBaseCheck {
    readonly metaData: BaseMetaData = gMetaData;

    // TypeScript/ArkTS 关键字和常用标识符（不做规范化）
    private readonly keywords = new Set([
        'let', 'const', 'var', 'function', 'return', 'if', 'else', 'for', 'while',
        'true', 'false', 'null', 'undefined', 'this', 'new', 'class', 'extends',
        'number', 'string', 'boolean', 'void', 'any', 'object',
        'length', 'push', 'pop', 'map', 'filter', 'forEach', 'indexOf',
        'console', 'log', 'toFixed', 'trim', 'toString',
        'parameter0', 'parameter1', 'parameter2'  // ArkAnalyzer 的参数占位符
    ]);

    protected getCloneType(): string {
        return "Type-2";
    }

    /**
     * 计算规范化后的哈希值
     * Type-2 需要将标识符替换为占位符
     */
    protected computeHash(stmts: Stmt[]): string {
        // 用于追踪已见过的标识符
        const identifierMap = new Map<string, string>();

        const stmtStrings = stmts.map(stmt => {
            let text = stmt.toString();
            // 先做基础规范化（去除路径、类名）
            text = this.normalizeBasic(text);
            // 再做标识符规范化
            text = this.normalizeIdentifiers(text, identifierMap);
            return text;
        });
        
        const combined = stmtStrings.join('|');
        return this.simpleHash(combined);
    }

    /**
     * 标识符规范化
     * 将变量名、函数名替换为 ID_1, ID_2 等
     */
    private normalizeIdentifiers(text: string, identifierMap: Map<string, string>): string {
        // 匹配标识符模式：字母开头，后跟字母、数字、下划线
        const identifierPattern = /\b([a-zA-Z_][a-zA-Z0-9_]*)\b/g;
        
        return text.replace(identifierPattern, (match) => {
            // 跳过关键字和短标识符
            if (this.keywords.has(match.toLowerCase()) || match.length <= 1) {
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
            const normalized = `ID_${identifierMap.size + 1}`;
            identifierMap.set(match, normalized);
            return normalized;
        });
    }

    protected getDescription(method: MethodInfo, cloneWith: MethodInfo): string {
        const cloneFileName = cloneWith.filePath.split('/').pop() ?? cloneWith.filePath;
        return `Code Clone Type-2: Method '${method.methodName}' (lines ${method.startLine}-${method.endLine}) ` +
            `is structurally identical to '${cloneWith.className}.${cloneWith.methodName}' in ${cloneFileName}:${cloneWith.startLine}-${cloneWith.endLine}. ` +
            `(${method.stmtCount} statements, renamed identifiers)`;
    }
}
