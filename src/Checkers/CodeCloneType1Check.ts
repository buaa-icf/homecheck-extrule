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
    ruleDocPath: "docs/code-clone-type1-check.md",
    description: 'Code Clone Type-1 detected: Identical code fragments found.'
};

/**
 * Code Clone Type-1 检测规则
 * 
 * Type-1 克隆：完全相同的代码片段（仅空白和注释可以不同）
 * 
 * 检测算法：
 * 1. 遍历所有文件中的方法
 * 2. 对每个方法计算语句序列的哈希值（基础规范化）
 * 3. 比较哈希值，找出相同的方法对
 * 4. 上报克隆对
 */
export class CodeCloneType1Check extends CodeCloneBaseCheck {
    readonly metaData: BaseMetaData = gMetaData;

    protected getCloneType(): string {
        return "Type-1";
    }

    /**
     * 计算语句序列的哈希值
     * Type-1 克隆要求完全相同，只做基础规范化
     */
    protected computeHash(stmts: Stmt[]): string {
        const stmtStrings = stmts.map(stmt => {
            let text = stmt.toString();
            text = this.normalizeBasic(text);
            return text;
        });
        
        const combined = stmtStrings.join('|');
        return this.simpleHash(combined);
    }

    protected getDescription(method: MethodInfo, cloneWith: MethodInfo): string {
        const cloneFileName = cloneWith.filePath.split('/').pop() ?? cloneWith.filePath;
        return `Code Clone Type-1: Method '${method.methodName}' (lines ${method.startLine}-${method.endLine}) ` +
            `is identical to '${cloneWith.className}.${cloneWith.methodName}' in ${cloneFileName}:${cloneWith.startLine}-${cloneWith.endLine}. ` +
            `(${method.stmtCount} statements)`;
    }
}
