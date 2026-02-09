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
import { ClassCategory } from "arkanalyzer/lib/core/model/ArkClass";
import { BaseMetaData, BaseChecker, Rule, MethodMatcher, MatcherTypes, MatcherCallback, IssueReport } from "homecheck";
import { createDefects, getRuleOption } from "./utils";

const gMetaData: BaseMetaData = {
    severity: 2,
    ruleDocPath: "docs/long-method-check.md",
    description: 'Method is too long. Consider refactoring it into smaller methods for better readability and maintainability.'
};

const UI_LIFECYCLE_METHODS = new Set([
    'aboutToAppear',
    'aboutToDisappear',
    'onPageShow',
    'onPageHide',
    'onBackPress'
]);

/**
 * Long Method 检测规则
 *
 * 检测方法是否过长，过长的方法通常存在以下问题：
 * 1. 难以理解和维护
 * 2. 包含多个职责，违反单一职责原则
 * 3. 难以测试和复用
 *
 * 阈值策略：
 * - 普通函数：默认 50 个语句节点
 * - UI 组装/渲染/构建类函数（build、@Builder、含 ViewTree 的方法等）：
 *   - 软阈值：80 个语句节点（severity 降为 warning）
 *   - 硬阈值：120 个语句节点（保持原 severity）
 *
 * 可通过 ruleConfig.json 配置各阈值参数
 */
export class LongMethodCheck implements BaseChecker {
    readonly metaData: BaseMetaData = gMetaData;
    public rule: Rule;
    public issues: IssueReport[] = [];

    private readonly DEFAULT_MAX_STMTS = 50;
    private readonly DEFAULT_MAX_UI_STMTS_SOFT = 80;
    private readonly DEFAULT_MAX_UI_STMTS_HARD = 120;

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
        const stmtCount = this.countMethodStmts(targetMtd);

        if (this.isUIMethod(targetMtd)) {
            this.checkUIMethod(targetMtd, stmtCount);
        } else {
            this.checkNormalMethod(targetMtd, stmtCount);
        }
    }

    private checkNormalMethod(method: ArkMethod, stmtCount: number): void {
        const maxStmts = this.getMaxStmtsFromConfig();
        if (stmtCount > maxStmts) {
            this.addIssueReport(method, stmtCount, maxStmts);
        }
    }

    private checkUIMethod(method: ArkMethod, stmtCount: number): void {
        const { softLimit, hardLimit } = this.getUIThresholdsFromConfig();

        if (stmtCount > hardLimit) {
            this.addIssueReport(method, stmtCount, hardLimit);
        } else if (stmtCount > softLimit) {
            this.addIssueReport(method, stmtCount, softLimit, 1);
        }
    }

    /**
     * 判断方法是否为 UI 组装/渲染/构建类方法
     *
     * 满足以下任一条件即视为 UI 方法：
     * 1. 方法本身带有 @Builder 装饰器
     * 2. 方法关联了 ViewTree（UI 渲染树）
     * 3. 方法名为 build 且所属类为 STRUCT（@Component struct 的 build 方法）
     * 4. 方法名为 UI 生命周期方法且所属类为 @Component struct
     */
    private isUIMethod(method: ArkMethod): boolean {
        if (method.hasBuilderDecorator()) {
            return true;
        }

        if (method.hasViewTree()) {
            return true;
        }

        const declaringClass = method.getDeclaringArkClass();
        if (declaringClass && declaringClass.getCategory() === ClassCategory.STRUCT) {
            const methodName = method.getName();

            if (methodName === 'build') {
                return true;
            }

            if (UI_LIFECYCLE_METHODS.has(methodName) && declaringClass.hasComponentDecorator()) {
                return true;
            }
        }

        return false;
    }

    /**
     * 从配置中获取普通方法的最大语句数阈值
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

    private getUIThresholdsFromConfig(): { softLimit: number; hardLimit: number } {
        const option = getRuleOption(this.rule, {
            maxUIStmtsSoft: Number.NaN,
            maxUIStmtsHard: Number.NaN
        });

        const softLimit = Number.isFinite(option.maxUIStmtsSoft)
            ? option.maxUIStmtsSoft
            : this.DEFAULT_MAX_UI_STMTS_SOFT;

        const hardLimit = Number.isFinite(option.maxUIStmtsHard)
            ? option.maxUIStmtsHard
            : this.DEFAULT_MAX_UI_STMTS_HARD;

        return { softLimit, hardLimit };
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

    private addIssueReport(method: ArkMethod, actualStmts: number, maxStmts: number, severityOverride?: number) {
        const severity = severityOverride ?? this.rule?.alert ?? this.metaData.severity;

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
