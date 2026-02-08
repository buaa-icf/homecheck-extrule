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
import { BaseMetaData, BaseChecker, Rule, MethodMatcher, MatcherTypes, MatcherCallback, IssueReport } from "homecheck";
import { createDefects, getRuleOption } from "./utils";

const gMetaData: BaseMetaData = {
    severity: 2,
    ruleDocPath: "docs/long-method-check.md",
    description: 'Method is too long. Consider refactoring it into smaller methods for better readability and maintainability.'
};

/**
 * Long Method 检测规则
 *
 * 检测方法是否过长，过长的方法通常存在以下问题：
 * 1. 难以理解和维护
 * 2. 包含多个职责，违反单一职责原则
 * 3. 难以测试和复用
 *
 * 默认阈值：50 个语句节点
 * 可通过 ruleConfig.json 配置 maxStmts 参数自定义阈值
 */
export class LongMethodCheck implements BaseChecker {
    readonly metaData: BaseMetaData = gMetaData;
    public rule: Rule;
    public issues: IssueReport[] = [];

    // 默认最大方法语句数阈值
    private readonly DEFAULT_MAX_STMTS = 50;

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
        // 获取配置的最大语句数阈值
        const maxStmts = this.getMaxStmtsFromConfig();

        // 计算方法的语句数量
        const stmtCount = this.countMethodStmts(targetMtd);

        // 如果超过阈值，则上报问题
        if (stmtCount > maxStmts) {
            this.addIssueReport(targetMtd, stmtCount, maxStmts);
        }
    }

    /**
     * 从配置中获取最大语句数阈值
     */
    private getMaxStmtsFromConfig(): number {
        const option = getRuleOption(this.rule, {
            maxStmts: Number.NaN,
            maxLines: Number.NaN
        });

        if (Number.isFinite(option.maxStmts)) {
            return option.maxStmts;
        }
        if (Number.isFinite(option.maxLines)) {
            return option.maxLines;
        }

        return this.DEFAULT_MAX_STMTS;
    }

    /**
     * 计算方法的语句数量
     * CFG 中的 stmts 已经包含了方法的所有语句（包括嵌套语句）
     */
    private countMethodStmts(method: ArkMethod): number {
        const body = method.getBody();
        if (!body) {
            return 0;
        }

        // getStmts() 返回方法的所有语句（包括控制流中的所有语句）
        const stmts = body.getCfg().getStmts();
        return stmts.length;
    }

    private addIssueReport(method: ArkMethod, actualStmts: number, maxStmts: number) {
        const severity = this.rule?.alert ?? this.metaData.severity;

        // 获取方法的位置信息
        const methodLine = method.getLine();
        const methodCol = method.getColumn();

        const line = methodLine ?? 0;
        const startCol = methodCol ?? 0;
        const endCol = startCol + method.getName().length;

        const arkFile = method.getDeclaringArkFile();
        const filePath = arkFile?.getFilePath() ?? '';

        // 构建描述信息，包含实际语句数、阈值和方法名
        const methodName = method.getName() ?? '';
        const description = `Method '${methodName}' is too long. Consider refactoring. (Current: ${actualStmts} statements, Max: ${maxStmts})`;

        this.issues.push(createDefects({
            line,
            startCol,
            endCol,
            description,
            severity,
            ruleId: this.rule.ruleId,
            filePath,
            ruleDocPath: this.metaData.ruleDocPath,
            methodName
        }));
    }
}
