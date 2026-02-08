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
import { normalizeIdentifiers, normalizeLiterals } from "./utils";

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

    protected getCloneType(): string {
        return "Type-2";
    }

    /**
     * 计算规范化后的哈希值
     * Type-2 需要将标识符替换为占位符
     * 如果配置了 ignoreLiterals: true，还会将字面量替换为占位符
     */
    protected computeHash(stmts: Stmt[]): string {
        // 用于追踪已见过的标识符
        const identifierMap = new Map<string, string>();
        // 读取配置：是否忽略字面量差异
        const ignoreLiterals = this.getIgnoreLiterals();

        const stmtStrings = stmts.map(stmt => {
            let text = stmt.toString();
            // 先做基础规范化（去除路径、类名）
            text = this.normalizeBasic(text);
            // 再做标识符规范化
            text = normalizeIdentifiers(text, identifierMap);
            // 如果配置了 ignoreLiterals，进行字面量规范化
            if (ignoreLiterals) {
                text = normalizeLiterals(text);
            }
            return text;
        });
        
        const combined = stmtStrings.join('|');
        return this.simpleHash(combined);
    }

    /**
     * 字面量规范化
     * 将数字、字符串替换为占位符
     * 
     * 注意：此功能可能导致误报，默认关闭
     * 只有当配置 ignoreLiterals: true 时才会调用
     * 
     * 规范化规则：
     * - 数字（整数、小数、十六进制、科学计数法）→ NUM
     * - 字符串（双引号、单引号）→ STR
     */
    protected getDescription(method: MethodInfo, cloneWith: MethodInfo): string {
        const cloneFileName = cloneWith.filePath.split('/').pop() ?? cloneWith.filePath;
        return `Code Clone Type-2: Method '${method.methodName}' (lines ${method.startLine}-${method.endLine}) ` +
            `is structurally identical to '${cloneWith.className}.${cloneWith.methodName}' in ${cloneFileName}:${cloneWith.startLine}-${cloneWith.endLine}. ` +
            `(${method.stmtCount} statements, renamed identifiers)`;
    }
}
