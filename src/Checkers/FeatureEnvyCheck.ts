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
import { BaseMetaData, MatcherCallback, MatcherTypes, MethodMatcher } from "homecheck";
import { RuleOptionSchema } from "./config/parseRuleOptions";
import { FeatureEnvyRuleOptions } from "./config/types";
import { BaseRuleChecker } from "./BaseRuleChecker";
import { buildFeatureEnvyFieldTypeMap, FeatureEnvyAnalyzer, FeatureEnvyMetrics } from "./feature-envy/analysis";
import { isArkUiMethod, shouldSkipMethod } from "./shared/ark";

// Heuristic detection for "Feature Envy" code smell: a method that tends to
// interact much more with another class than with its own.
const gMetaData: BaseMetaData = {
    severity: 2,
    ruleDocPath: "docs/feature-envy-check.md",
    description: "Method excessively uses members of another class (Feature Envy)."
};

const FEATURE_ENVY_OPTIONS_SCHEMA: RuleOptionSchema<FeatureEnvyRuleOptions> = {
    atfdThreshold: { type: "number", min: 0 },
    ldaThreshold: { type: "number", min: 0, max: 1 },
    cpfdThreshold: { type: "number", min: 0 }
};

const DEFAULT_OPTIONS: FeatureEnvyRuleOptions = {
    atfdThreshold: 4,
    ldaThreshold: 0.33,
    cpfdThreshold: 2
};

/**
 * Detects "Feature Envy" through ATFD/LDA/CPFD metrics recovered from CFG statements.
 */
export class FeatureEnvyCheck extends BaseRuleChecker<FeatureEnvyRuleOptions> {
    readonly metaData: BaseMetaData = gMetaData;

    protected readonly optionSchema = FEATURE_ENVY_OPTIONS_SCHEMA;
    protected readonly defaultOptions = DEFAULT_OPTIONS;

    // Match every method.
    private methodMatcher: MethodMatcher = {
        matcherType: MatcherTypes.METHOD
    };

    /**
     * Register the method-level matcher for this checker.
     */
    public registerMatchers(): MatcherCallback[] {
        return [{ matcher: this.methodMatcher, callback: this.check }];
    }

    /**
     * Analyze a method's call targets and report if dominated by one foreign class.
     */
    public check = (targetMtd: ArkMethod) => {
        const methodName = targetMtd.getName() ?? "";
        if (shouldSkipMethod(methodName) || isArkUiMethod(targetMtd)) {
            return;
        }

        const body = targetMtd.getBody();
        if (!body) {
            return;
        }

        const stmts = body.getCfg().getStmts();
        if (!stmts.length) {
            return;
        }

        const selfClass = targetMtd.getSignature().getDeclaringClassSignature().getClassName();
        const analyzer = new FeatureEnvyAnalyzer(selfClass, buildFeatureEnvyFieldTypeMap(targetMtd));
        const analysis = analyzer.analyze(stmts);
        const { metrics, pureMappingAdapter } = analysis;
        const { atfdThreshold, ldaThreshold, cpfdThreshold } = this.getOptions();

        if (!metrics.dominantProvider) {
            return;
        }

        if (pureMappingAdapter) {
            return;
        }

        const envyDetected = metrics.atfd > atfdThreshold
            && metrics.lda < ldaThreshold
            && metrics.cpfd <= cpfdThreshold;
        if (!envyDetected) {
            return;
        }

        this.addIssueReport(targetMtd, metrics);
    }
    private getMethodPosition(method: ArkMethod): { line: number; startCol: number; endCol: number; filePath: string } {
        const line = method.getLine() ?? 0;
        const startCol = method.getColumn() ?? 0;
        const endCol = startCol + (method.getName()?.length ?? 0);
        const filePath = method.getDeclaringArkFile()?.getFilePath() ?? "";
        return { line, startCol, endCol, filePath };
    }

    /**
     * Emit an IssueReport describing the detected Feature Envy.
     */
    private addIssueReport(method: ArkMethod, metrics: FeatureEnvyMetrics) {
        const { line, startCol, endCol, filePath } = this.getMethodPosition(method);
        const methodName = method.getName() ?? "<unknown>";
        const description = `Method '${methodName}' is feature-envious toward '${metrics.dominantProvider}' (ATFD=${metrics.atfd}, LDA=${metrics.lda.toFixed(2)}, CPFD=${metrics.cpfd}). Consider moving logic or introducing delegation.`;

        this.reportIssue({
            line,
            startCol,
            endCol,
            description,
            filePath,
            methodName,
        });
    }
}
