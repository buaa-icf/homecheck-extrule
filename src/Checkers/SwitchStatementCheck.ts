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
import { BaseMetaData, MatcherCallback, MatcherTypes, MethodMatcher } from "homecheck";
import { RuleOptionSchema } from "./config/parseRuleOptions";
import { SwitchStatementRuleOptions } from "./config/types";
import { BaseRuleChecker } from "./BaseRuleChecker";
import {
    buildSwitchKey,
    calculateCaseLineCounts,
    CaseLineCount,
    collectBraceDelimitedBlock,
    collectSourceSwitchBlocks,
    containsSwitch,
    countCases,
    countElseIfChainBranches,
    isNestedInsideElseBlock,
    scanConditionalTokens
} from "./switch-statement/sourceAnalysis";

// Detect "Switch Statement" smell: large switch blocks or long if/else-if chains
// that may signal missing polymorphism.
const gMetaData: BaseMetaData = {
    severity: 2,
    ruleDocPath: "docs/switch-statement-check.md",
    description: "Large switch statement or if-else chain detected; consider replacing with polymorphism."
};

const SWITCH_OPTIONS_SCHEMA: RuleOptionSchema<SwitchStatementRuleOptions> = {
    minCases: { type: "number", min: 1 }
};

const DEFAULT_OPTIONS: SwitchStatementRuleOptions = {
    minCases: 6
};

interface SwitchIssueParams {
    method: ArkMethod;
    caseCount: number;
    caseLineCounts: CaseLineCount[];
    line: number;
    startCol: number;
    endCol: number;
    filePath: string;
}

interface IfElseChainIssueParams {
    method: ArkMethod;
    branchCount: number;
    line: number;
    startCol: number;
    endCol: number;
    filePath: string;
}

/**
 * Detects large switch statements and long if / else if chains.
 * Uses CFG statements for switch structure and source scans as fallback/if-chain path.
 */
export class SwitchStatementCheck extends BaseRuleChecker<SwitchStatementRuleOptions> {
    readonly metaData: BaseMetaData = gMetaData;

    protected readonly optionSchema = SWITCH_OPTIONS_SCHEMA;
    protected readonly defaultOptions = DEFAULT_OPTIONS;

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
     * Scan a method for switch blocks and if-else chains, reporting those above the threshold.
     *
     * Detection proceeds in three stages:
     * 1. CFG-based switch detection (structural, precise)
     * 2. Source-based switch detection (fallback for switches flattened in CFG)
     * 3. Source-based if-else chain detection (avoids CFG's overlapping ArkIfStmt nodes)
     */
    public check = (targetMtd: ArkMethod) => {
        const body = targetMtd.getBody();
        if (!body) {
            return;
        }

        const stmts = body.getCfg().getStmts();
        const reported = new Set<string>();

        this.detectSwitchesFromCfg(targetMtd, stmts, reported);
        this.detectFromSource(targetMtd, reported);
        this.detectIfElseChainsFromSource(targetMtd);
    }

    /**
     * Detect switch statements from CFG statement stream.
     */
    private detectSwitchesFromCfg(method: ArkMethod, stmts: Stmt[], reported: Set<string>): void {
        const stmtTexts = stmts.map(stmt => this.getStmtText(stmt));

        for (let i = 0; i < stmts.length; i++) {
            const stmt = stmts[i];
            const text = stmtTexts[i];
            if (!containsSwitch(text)) {
                continue;
            }

            const switchBlockText = collectBraceDelimitedBlock(stmtTexts, i);
            const caseCount = countCases(switchBlockText);
            if (caseCount >= this.getCaseThreshold()) {
                const caseLineCounts = calculateCaseLineCounts(switchBlockText);
                const originPosition = stmt.getOriginPositionInfo();
                this.addSwitchIssueReport({
                    method,
                    caseCount,
                    caseLineCounts,
                    line: originPosition.getLineNo(),
                    startCol: originPosition.getColNo(),
                    endCol: originPosition.getColNo() + (stmt.getOriginalText()?.length ?? 0),
                    filePath: stmt.getCfg()?.getDeclaringMethod().getDeclaringArkFile()?.getFilePath() ?? "",
                });
                reported.add(buildSwitchKey(originPosition.getLineNo(), caseCount));
            }
        }
    }

    /**
     * Prefer original source text for accurate brace/case counting.
     */
    private getStmtText(stmt: Stmt): string {
        return stmt.getOriginalText() ?? stmt.toString();
    }

    /**
     * Fallback scan over raw source to catch switches that CFG misses.
     * De-duplicates with the `reported` key set.
     */
    private detectFromSource(method: ArkMethod, reported: Set<string>): void {
        const code = method.getCode();
        if (!code) {
            return;
        }

        const lines = code.split(/\r?\n/);
        for (const block of collectSourceSwitchBlocks(lines)) {
            const caseCount = countCases(block.text);
            if (caseCount < this.getCaseThreshold()) {
                continue;
            }

            const key = buildSwitchKey(block.startLineIndex + 1, caseCount);
            if (reported.has(key)) {
                continue;
            }

            this.addSwitchIssueReport({
                method,
                caseCount,
                caseLineCounts: calculateCaseLineCounts(block.text),
                line: block.startLineIndex + 1,
                startCol: block.switchColumn,
                endCol: block.switchColumn + 1,
                filePath: method.getDeclaringArkFile()?.getFilePath() ?? "",
            });
            reported.add(key);
        }
    }

    /**
     * Detect long if / else if chains from raw source.
     * This path deliberately avoids CFG reconstruction because ArkAnalyzer expands
     * else-if chains into overlapping ArkIfStmt nodes.
     */
    private detectIfElseChainsFromSource(method: ArkMethod): void {
        const code = method.getCode();
        if (!code) {
            return;
        }

        const conditionalTokens = scanConditionalTokens(code);
        const threshold = this.getCaseThreshold();

        for (let i = 0; i < conditionalTokens.length; i++) {
            const token = conditionalTokens[i];
            if (token.kind !== "if") {
                continue;
            }
            if (isNestedInsideElseBlock(conditionalTokens, i)) {
                continue;
            }

            const branchCount = countElseIfChainBranches(conditionalTokens, i);
            if (branchCount < threshold) {
                continue;
            }

            this.addIfElseChainIssueReport({
                method,
                branchCount,
                line: token.line,
                startCol: token.column,
                endCol: token.column + 2,
                filePath: method.getDeclaringArkFile()?.getFilePath() ?? "",
            });
        }
    }

    /**
     * Resolve the case-count threshold from rule options or defaults.
     */
    private getCaseThreshold(): number {
        return this.getOptions().minCases;
    }

    /**
     * Report a switch statement issue.
     */
    private addSwitchIssueReport(params: SwitchIssueParams): void {
        const { method, caseCount, caseLineCounts, line, startCol, endCol, filePath } = params;

        const caseLineSummary = caseLineCounts.length > 0
            ? caseLineCounts.map(({ label, lines }) => `${label} (${lines} line${lines === 1 ? "" : "s"})`).join("; ")
            : "unavailable";

        const description = `Switch statement with ${caseCount} cases detected in method '${method.getName()}'. Consider using polymorphism or strategy. Case line counts: ${caseLineSummary}.`;

        this.reportIssue({
            line,
            startCol,
            endCol,
            description,
            filePath,
            methodName: method.getName(),
        });
    }

    /**
     * Report an if-else chain issue.
     */
    private addIfElseChainIssueReport(params: IfElseChainIssueParams): void {
        const { method, branchCount, line, startCol, endCol, filePath } = params;

        const description = `Long if-else chain with ${branchCount} branches detected in method '${method.getName()}'. Consider using polymorphism or strategy.`;

        this.reportIssue({
            line,
            startCol,
            endCol,
            description,
            filePath,
            methodName: method.getName(),
        });
    }
}
