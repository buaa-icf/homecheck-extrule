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

import { ArkMethod } from "arkanalyzer";
import { BaseMetaData, MethodMatcher, MatcherTypes, MatcherCallback } from "homecheck";
import { RuleOptionSchema } from "./config/parseRuleOptions";
import { LongMethodRuleOptions } from "./config/types";
import { BaseRuleChecker } from "./BaseRuleChecker";
import { isArkUiMethod } from "./shared";

const gMetaData: BaseMetaData = {
    severity: 2,
    ruleDocPath: "docs/long-method-check.md",
    description: 'Method is too long. Consider refactoring it into smaller methods for better readability and maintainability.'
};

const LONG_METHOD_OPTIONS_SCHEMA: RuleOptionSchema<LongMethodRuleOptions> = {
    maxStmts: { type: "number", min: 0 },
    maxLines: { type: "number", min: 0, allowNaN: true },
    maxUIStmtsSoft: { type: "number", min: 0 },
    maxUIStmtsHard: { type: "number", min: 0 }
};

const DEFAULT_OPTIONS: LongMethodRuleOptions = {
    maxStmts: Number.NaN,
    maxLines: Number.NaN,
    maxUIStmtsSoft: Number.NaN,
    maxUIStmtsHard: Number.NaN
};

/**
 * Long Method 检测规则
 *
 * 检测方法是否过长，过长的方法通常存在以下问题：
 * 1. 难以理解和维护
 * 2. 包含多个职责，违反单一职责原则
 * 3. 难以测试和复用
 *
 * 阈值策略：
 * - 普通函数：默认 50 行代码
 * - UI 组装/渲染/构建类函数（build、@Builder、含 ViewTree 的方法等）：
 *   - 软阈值：80 行代码（severity 降为 warning）
 *   - 硬阈值：120 行代码（保持原 severity）
 *
 * 可通过 ruleConfig.json 配置各阈值参数
 */
export class LongMethodCheck extends BaseRuleChecker<LongMethodRuleOptions> {
    readonly metaData: BaseMetaData = gMetaData;

    protected readonly optionSchema = LONG_METHOD_OPTIONS_SCHEMA;
    protected readonly defaultOptions = DEFAULT_OPTIONS;

    private readonly DEFAULT_MAX_LINES = 50;
    private readonly DEFAULT_MAX_UI_LINES_SOFT = 80;
    private readonly DEFAULT_MAX_UI_LINES_HARD = 120;

    // 匹配所有方法
    private methodMatcher: MethodMatcher = {
        matcherType: MatcherTypes.METHOD
    };

    public registerMatchers(): MatcherCallback[] {
        const matchMethodCb: MatcherCallback = {
            matcher: this.methodMatcher,
            callback: this.check
        };
        return [matchMethodCb];
    }

    public check = (targetMtd: ArkMethod) => {
        const codeLineCount = this.countMethodCodeLines(targetMtd);

        if (isArkUiMethod(targetMtd)) {
            this.checkUIMethod(targetMtd, codeLineCount);
        } else {
            this.checkNormalMethod(targetMtd, codeLineCount);
        }
    }

    private checkNormalMethod(method: ArkMethod, codeLineCount: number): void {
        const maxLines = this.getMaxCodeLinesFromConfig();
        if (codeLineCount > maxLines) {
            this.addIssueReport(method, codeLineCount, maxLines);
        }
    }

    private checkUIMethod(method: ArkMethod, codeLineCount: number): void {
        const { softLimit, hardLimit } = this.getUIThresholdsFromConfig();

        if (codeLineCount > hardLimit) {
            this.addIssueReport(method, codeLineCount, hardLimit);
        } else if (codeLineCount > softLimit) {
            this.addIssueReport(method, codeLineCount, softLimit, 1);
        }
    }

    /**
     * 从配置中获取普通方法的最大代码行数阈值
     */
    private getMaxCodeLinesFromConfig(): number {
        const option = this.getOptions();

        if (Number.isFinite(option.maxLines)) {
            return option.maxLines;
        }
        if (Number.isFinite(option.maxStmts)) {
            return option.maxStmts;
        }

        return this.DEFAULT_MAX_LINES;
    }

    private getUIThresholdsFromConfig(): { softLimit: number; hardLimit: number } {
        const option = this.getOptions();

        const softLimit = Number.isFinite(option.maxUIStmtsSoft)
            ? option.maxUIStmtsSoft
            : this.DEFAULT_MAX_UI_LINES_SOFT;

        const hardLimit = Number.isFinite(option.maxUIStmtsHard)
            ? option.maxUIStmtsHard
            : this.DEFAULT_MAX_UI_LINES_HARD;

        return { softLimit, hardLimit };
    }

    /**
     * 计算方法的代码行数。
     * 优先使用源码文本统计非空且非纯大括号行；若源码缺失则回退到 CFG 节点数。
     */
    private countMethodCodeLines(method: ArkMethod): number {
        const code = method.getCode();
        if (code) {
            return code
                .split(/\r?\n/)
                .map(line => line.trim())
                .filter(line => line.length > 0 && line !== '{' && line !== '}')
                .length;
        }

        const body = method.getBody();
        if (!body) {
            return 0;
        }

        return body.getCfg().getStmts().length;
    }

    private addIssueReport(method: ArkMethod, actualLines: number, maxLines: number, severityOverride?: number) {
        const line = method.getLine() ?? 0;
        const startCol = method.getColumn() ?? 0;
        const endCol = startCol + method.getName().length;
        const filePath = method.getDeclaringArkFile()?.getFilePath() ?? '';
        const methodName = method.getName() ?? '';
        const description = `Method '${methodName}' is too long. Consider refactoring. (Current: ${actualLines} lines, Max: ${maxLines})`;

        this.reportIssue({
            line,
            startCol,
            endCol,
            description,
            filePath,
            methodName,
            severity: severityOverride !== undefined ? severityOverride : undefined,
        });
    }
}
