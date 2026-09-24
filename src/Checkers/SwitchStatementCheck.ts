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
    calculateCaseLineCounts,
    CaseLineCount,
    collectBraceDelimitedBlockLazy,
    collectSourceSwitchBlocks,
    countCases,
    countElseIfChainBranches,
    isNestedInsideElseBlock,
    scanConditionalTokens,
    startsWithSwitch
} from "./switch-statement/sourceAnalysis";
import { PerfReporter } from "./perf";

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
    endLine: number;
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

    /** 同一源码 switch 可能同时属于普通方法和 ArkAnalyzer 生成的匿名方法。 */
    private reportedSwitches = new Map<string, { issueIndex: number; methodName: string }>();

    private methodMatcher: MethodMatcher = {
        matcherType: MatcherTypes.METHOD,
        // 直接匹配当前派发的方法，避免旧兼容分支产生 N×N 方法回调。
        match: () => true
    };

    /**
     * Register the method-level matcher for this checker.
     */
    public registerMatchers(): MatcherCallback[] {
        return [{ matcher: this.methodMatcher, callback: this.check }];
    }

    public beforeCheck(): void {
        super.beforeCheck();
        this.reportedSwitches.clear();
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
        PerfReporter.time(this.constructor.name, 'check', () => {
            if (!this.shouldCheckMethod(targetMtd)) {
                return;
            }
            const body = targetMtd.getBody();
            if (!body) {
                return;
            }

            const stmts = body.getCfg().getStmts();
            const code = targetMtd.getCode();

            // ArkAnalyzer may fail to reconstruct source for an otherwise valid CFG.
            // Preserve CFG switch detection in that case instead of dropping findings.
            if (!code) {
                this.detectSwitchesFromCfg(targetMtd, stmts);
                return;
            }

            const mayContainSwitch = code.includes("switch");
            const mayContainIf = code.includes("if");
            if (!mayContainSwitch && !mayContainIf) {
                return;
            }

            if (mayContainSwitch) {
                // 有源码时以真实源码节点为准。CFG 中的外层回调/if/for 语句可能把
                // 内部 switch 的整段文本作为 originalText，不能与源码扫描并行上报。
                this.detectFromSource(targetMtd, code);
            }
            if (mayContainIf) {
                this.detectIfElseChainsFromSource(targetMtd, code);
            }
        });
    }

    /**
     * Detect switch statements from CFG statement stream.
     */
    private detectSwitchesFromCfg(method: ArkMethod, stmts: Stmt[]): void {
        for (let i = 0; i < stmts.length; i++) {
            const stmt = stmts[i];
            const text = this.getStmtText(stmt);
            if (!startsWithSwitch(text)) {
                continue;
            }

            const switchBlockText = collectBraceDelimitedBlockLazy(
                stmts.length,
                index => index === i ? text : this.getStmtText(stmts[index]),
                i
            );
            const caseCount = countCases(switchBlockText);
            if (caseCount >= this.getCaseThreshold()) {
                const caseLineCounts = calculateCaseLineCounts(switchBlockText);
                const originPosition = stmt.getOriginPositionInfo();
                this.reportSwitchOnce({
                    method,
                    caseCount,
                    caseLineCounts,
                    line: originPosition.getLineNo(),
                    endLine: originPosition.getLineNo() + switchBlockText.split(/\r?\n/).length - 1,
                    startCol: originPosition.getColNo(),
                    endCol: originPosition.getColNo() + (stmt.getOriginalText()?.length ?? 0),
                    filePath: stmt.getCfg()?.getDeclaringMethod().getDeclaringArkFile()?.getFilePath() ?? "",
                });
            }
        }
    }

    /**
     * Prefer original source text for accurate brace/case counting.
     */
    private getStmtText(stmt: Stmt): string {
        return stmt.getOriginalText() ?? stmt.toString();
    }

    /** Scan raw source so reports are anchored to the actual switch node. */
    private detectFromSource(method: ArkMethod, code: string): void {
        const lines = code.split(/\r?\n/);
        for (const block of collectSourceSwitchBlocks(lines)) {
            const caseCount = countCases(block.text);
            if (caseCount < this.getCaseThreshold()) {
                continue;
            }

            const absoluteLine = this.toAbsoluteSourceLine(method, block.startLineIndex + 1);
            this.reportSwitchOnce({
                method,
                caseCount,
                caseLineCounts: calculateCaseLineCounts(block.text),
                line: absoluteLine,
                endLine: this.toAbsoluteSourceLine(method, block.endLineIndex + 1),
                startCol: block.switchColumn,
                endCol: block.switchColumn + 1,
                filePath: method.getDeclaringArkFile()?.getFilePath() ?? "",
            });
        }
    }

    /**
     * 以源码文件和真实 switch 起点作为身份，跨 ArkMethod 去重。
     * 若匿名方法先被派发，后续普通方法会替换其归属，报告行仍是 switch 起始行。
     */
    private reportSwitchOnce(params: SwitchIssueParams): void {
        const normalizedPath = params.filePath.replace(/\\/g, "/").toLowerCase();
        const key = `${normalizedPath}:${params.line}:${params.endLine}`;
        const methodName = params.method.getName();
        const existing = this.reportedSwitches.get(key);

        if (!existing) {
            const issueIndex = this.issues.length;
            this.addSwitchIssueReport(params);
            this.reportedSwitches.set(key, { issueIndex, methodName });
            return;
        }

        if (existing.methodName.startsWith("%") && !methodName.startsWith("%")) {
            this.addSwitchIssueReport(params);
            this.issues[existing.issueIndex] = this.issues.pop()!;
            this.reportedSwitches.set(key, { issueIndex: existing.issueIndex, methodName });
        }
    }

    /**
     * Detect long if / else if chains from raw source.
     * This path deliberately avoids CFG reconstruction because ArkAnalyzer expands
     * else-if chains into overlapping ArkIfStmt nodes.
     */
    private detectIfElseChainsFromSource(method: ArkMethod, code: string): void {
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
                line: this.toAbsoluteSourceLine(method, token.line),
                startCol: token.column,
                endCol: token.column + 2,
                filePath: method.getDeclaringArkFile()?.getFilePath() ?? "",
            });
        }
    }

    /** ArkMethod.getCode() uses method-relative lines; reports must use source-file lines. */
    private toAbsoluteSourceLine(method: ArkMethod, relativeLine: number): number {
        const methodStartLine = method.getLine() ?? 1;
        return Math.max(1, methodStartLine) + Math.max(1, relativeLine) - 1;
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
