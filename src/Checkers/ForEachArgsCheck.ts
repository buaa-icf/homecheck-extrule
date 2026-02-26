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

import { ArkMethod, Stmt } from "arkanalyzer";
import { ClassCategory } from "arkanalyzer/lib/core/model/ArkClass";
import Logger, { LOG_MODULE_TYPE } from "arkanalyzer/lib/utils/logger";
import {
    BaseMetaData,
    BaseChecker,
    Rule,
    ClassMatcher,
    MatcherTypes,
    MethodMatcher,
    MatcherCallback,
    CheckerUtils,
    IssueReport
} from "homecheck";
import { parseRuleOptions, RuleOptionSchema } from "./config/parseRuleOptions";
import { ForeachArgsRuleOptions } from "./config/types";
import { createDefects } from "./utils";

const logger = Logger.getLogger(LOG_MODULE_TYPE.HOMECHECK, "ForeachArgsCheck");
const gMetaData: BaseMetaData = {
    severity: 1,
    ruleDocPath: "docs/foreach-args-check.md",
    description: "For performance purposes, set keyGenerator for ForEach."
};

const FOREACH_ARGS_SCHEMA: RuleOptionSchema<ForeachArgsRuleOptions> = {
    minArgs: { type: "number", min: 1 }
};

export class ForeachArgsCheck implements BaseChecker {
    readonly metaData: BaseMetaData = gMetaData;
    readonly FOREACH_CLASS: string = "ForEach";
    readonly CREATE_METHOD: string = "create";
    public rule: Rule;
    public issues: IssueReport[] = [];

    private readonly defaultOptions: ForeachArgsRuleOptions = {
        minArgs: 3
    };

    private options: ForeachArgsRuleOptions = this.defaultOptions;
    private optionsInitialized: boolean = false;

    private clsMatcher: ClassMatcher = {
        matcherType: MatcherTypes.CLASS,
        category: [ClassCategory.STRUCT]
    };
    private buildMatcher: MethodMatcher = {
        matcherType: MatcherTypes.METHOD,
        class: [this.clsMatcher],
        name: ["build"]
    };
    private builderMatcher: MethodMatcher = {
        matcherType: MatcherTypes.METHOD,
        decorators: ["Builder"]
    };

    public beforeCheck(): void {
        this.issues = [];
        this.options = parseRuleOptions(this.rule, FOREACH_ARGS_SCHEMA, this.defaultOptions);
        this.optionsInitialized = true;
    }

    private getOptions(): ForeachArgsRuleOptions {
        if (!this.optionsInitialized) {
            this.options = parseRuleOptions(this.rule, FOREACH_ARGS_SCHEMA, this.defaultOptions);
            this.optionsInitialized = true;
        }
        return this.options;
    }

    public registerMatchers(): MatcherCallback[] {
        const matchBuildCb: MatcherCallback = {
            matcher: this.buildMatcher,
            callback: this.check
        };
        const matchBuilderCb: MatcherCallback = {
            matcher: this.builderMatcher,
            callback: this.check
        };
        return [matchBuildCb, matchBuilderCb];
    }

    public check = (targetMtd: ArkMethod) => {
        const stmts = targetMtd.getBody()?.getCfg().getStmts() ?? [];
        const minArgs = this.getOptions().minArgs;

        for (const stmt of stmts) {
            const invokeExpr = CheckerUtils.getInvokeExprFromStmt(stmt);
            if (!invokeExpr) {
                continue;
            }
            const methodSign = invokeExpr.getMethodSignature();
            const className = methodSign.getDeclaringClassSignature().getClassName();
            const methodName = methodSign.getMethodSubSignature().getMethodName();
            const argsNum = invokeExpr.getArgs().length;
            if (className === this.FOREACH_CLASS && methodName === this.CREATE_METHOD && argsNum < minArgs) {
                this.addIssueReport(stmt);
            }
        }
    };

    private addIssueReport(stmt: Stmt) {
        const severity = this.rule?.alert ?? this.metaData.severity;
        const warnInfo = this.getLineAndColumn(stmt);
        this.issues.push(createDefects({
            line: warnInfo.line,
            startCol: warnInfo.startCol,
            endCol: warnInfo.endCol,
            description: this.metaData.description,
            severity,
            ruleId: this.rule.ruleId,
            filePath: warnInfo.filePath,
            ruleDocPath: this.metaData.ruleDocPath
        }));
    }

    private getLineAndColumn(stmt: Stmt) {
        const originPosition = stmt.getOriginPositionInfo();
        const line = originPosition.getLineNo();
        const arkFile = stmt.getCfg()?.getDeclaringMethod().getDeclaringArkFile();
        if (arkFile) {
            const originText = stmt.getOriginalText() ?? "";
            let startCol = originPosition.getColNo();
            const pos = originText.indexOf(this.FOREACH_CLASS);
            if (pos !== -1) {
                startCol += pos;
                const endCol = startCol + this.FOREACH_CLASS.length - 1;
                const originPath = arkFile.getFilePath();
                return { line, startCol, endCol, filePath: originPath };
            }
        } else {
            logger.debug("arkFile is null");
        }
        return { line: -1, startCol: -1, endCol: -1, filePath: "" };
    }
}
