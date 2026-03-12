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

type ConditionalLineKind = "if" | "elseIf" | "else" | "other";

interface ConditionalLineInfo {
    kind: ConditionalLineKind;
    effectiveDepth: number;
    keywordColumn: number;
    text: string;
}

interface SwitchIssueParams {
    method: ArkMethod;
    caseCount: number;
    caseLineCounts: Array<{ label: string; lines: number }>;
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
        for (let i = 0; i < stmts.length; i++) {
            const stmt = stmts[i];
            const text = this.getStmtText(stmt);
            if (!this.containsSwitch(text)) {
                continue;
            }

            const switchBlockText = this.collectSwitchBlockText(stmts, i);
            const caseCount = this.countCases(switchBlockText);
            if (caseCount >= this.getCaseThreshold()) {
                const caseLineCounts = this.calculateCaseLineCounts(switchBlockText);
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
                reported.add(this.buildSwitchKey(originPosition.getLineNo(), caseCount));
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
     * Basic switch detection on a single line of text.
     */
    private containsSwitch(text: string): boolean {
        return /\bswitch\s*\(/.test(text);
    }

    /**
     * Count case/default labels inside a switch block.
     */
    private countCases(text: string): number {
        const matches = text.match(/\bcase\b|\bdefault\b/g);
        return matches ? matches.length : 0;
    }

    /**
     * Collect the textual switch block starting at a statement index.
     * Uses brace depth to determine the block end.
     */
    private collectSwitchBlockText(stmts: Stmt[], startIdx: number): string {
        const lines: string[] = [];
        let braceDepth = 0;
        let started = false;

        for (let i = startIdx; i < stmts.length; i++) {
            const text = this.getStmtText(stmts[i]);
            const open = (text.match(/\{/g)?.length ?? 0);
            const close = (text.match(/\}/g)?.length ?? 0);

            if (!started) {
                // Ensure we include the switch line even if it lacks '{' on the same line.
                started = true;
                braceDepth += open - close;
                lines.push(text);
                continue;
            }

            braceDepth += open - close;
            lines.push(text);

            if (braceDepth <= 0) {
                break;
            }
        }

        return lines.join("\n");
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

        let inSwitch = false;
        let braceDepth = 0;
        let blockLines: string[] = [];
        let startLine = 0;

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            if (!inSwitch) {
                if (this.containsSwitch(line)) {
                    inSwitch = true;
                    startLine = i;
                    blockLines = [line];
                    braceDepth = (line.match(/\{/g)?.length ?? 0) - (line.match(/\}/g)?.length ?? 0);
                    if (braceDepth === 0) {
                        // If switch line lacks '{', continue to find block start.
                        continue;
                    }
                    if (braceDepth < 0) {
                        // Unbalanced; abandon this switch.
                        inSwitch = false;
                        blockLines = [];
                    }
                }
                continue;
            }

            // In switch block
            blockLines.push(line);
            braceDepth += (line.match(/\{/g)?.length ?? 0);
            braceDepth -= (line.match(/\}/g)?.length ?? 0);

            if (braceDepth <= 0) {
                this.flushSwitchBlock(method, blockLines, lines, startLine, reported);
                inSwitch = false;
                blockLines = [];
            }
        }

        // Handle unterminated block (best-effort)
        if (inSwitch) {
            this.flushSwitchBlock(method, blockLines, lines, startLine, reported);
        }
    }

    /**
     * Evaluate a collected switch block and report if it exceeds the threshold.
     */
    private flushSwitchBlock(
        method: ArkMethod,
        blockLines: string[],
        allLines: string[],
        startLine: number,
        reported: Set<string>
    ): void {
        if (!blockLines.length) {
            return;
        }

        const blockText = blockLines.join("\n");
        const caseCount = this.countCases(blockText);
        if (caseCount < this.getCaseThreshold()) {
            return;
        }

        const caseLineCounts = this.calculateCaseLineCounts(blockText);
        // Columns are best-effort; we align to start of switch line.
        const col = (allLines[startLine].indexOf("switch") >= 0) ? allLines[startLine].indexOf("switch") : 0;
        const key = this.buildSwitchKey(startLine + 1, caseCount);
        if (!reported.has(key)) {
            this.addSwitchIssueReport({
                method,
                caseCount,
                caseLineCounts,
                line: startLine + 1,
                startCol: col,
                endCol: col + 1,
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

        const lines = code.split(/\r?\n/);
        const lineInfos = this.buildConditionalLineInfos(lines);
        const threshold = this.getCaseThreshold();

        for (let i = 0; i < lineInfos.length; i++) {
            const info = lineInfos[i];
            if (info.kind !== "if") {
                continue;
            }
            if (this.isNestedInsideElseBlock(lineInfos, i)) {
                continue;
            }

            const branchCount = this.countElseIfChainBranches(lineInfos, i);
            if (branchCount < threshold) {
                continue;
            }

            this.addIfElseChainIssueReport({
                method,
                branchCount,
                line: i + 1,
                startCol: info.keywordColumn,
                endCol: info.keywordColumn + 2,
                filePath: method.getDeclaringArkFile()?.getFilePath() ?? "",
            });
        }
    }

    /**
     * Create a stable-ish dedupe key for a detected switch block.
     */
    private buildSwitchKey(line: number, caseCount: number): string {
        return `${line}-${caseCount}`;
    }

    private buildConditionalLineInfos(lines: string[]): ConditionalLineInfo[] {
        const infos: ConditionalLineInfo[] = [];
        let depth = 0;

        for (const line of lines) {
            const text = this.stripLineComment(line);
            const leadingMatch = text.match(/^(\s*)(\}*)\s*(.*)$/);
            const leadingClosers = leadingMatch?.[2].length ?? 0;
            const effectiveDepth = Math.max(0, depth - leadingClosers);
            const remaining = leadingMatch?.[3] ?? "";

            let kind: ConditionalLineKind = "other";
            if (/^else\s+if\b/.test(remaining)) {
                kind = "elseIf";
            } else if (/^else\b/.test(remaining)) {
                kind = "else";
            } else if (/^if\b/.test(remaining)) {
                kind = "if";
            }

            const keyword = kind === "if" ? "if" : kind === "other" ? "" : "else";
            infos.push({
                kind,
                effectiveDepth,
                keywordColumn: keyword ? text.indexOf(keyword) : 0,
                text,
            });

            depth += (text.match(/\{/g)?.length ?? 0);
            depth -= (text.match(/\}/g)?.length ?? 0);
            depth = Math.max(0, depth);
        }

        return infos;
    }

    private stripLineComment(line: string): string {
        const commentIndex = line.indexOf("//");
        return commentIndex >= 0 ? line.slice(0, commentIndex) : line;
    }

    private isNestedInsideElseBlock(lineInfos: ConditionalLineInfo[], startLine: number): boolean {
        const currentDepth = lineInfos[startLine].effectiveDepth;
        if (currentDepth <= 0) {
            return false;
        }

        for (let i = startLine - 1; i >= 0; i--) {
            const candidate = lineInfos[i];
            if (!candidate.text.trim()) {
                continue;
            }
            if (candidate.effectiveDepth < currentDepth) {
                return candidate.kind === "else" && candidate.effectiveDepth === currentDepth - 1;
            }
        }

        return false;
    }

    private countElseIfChainBranches(lineInfos: ConditionalLineInfo[], startLine: number): number {
        const chainDepth = lineInfos[startLine].effectiveDepth;
        let branches = 1;

        for (let i = startLine + 1; i < lineInfos.length; i++) {
            const candidate = lineInfos[i];
            if (!candidate.text.trim()) {
                continue;
            }
            if (candidate.effectiveDepth < chainDepth) {
                break;
            }
            if (candidate.effectiveDepth > chainDepth) {
                continue;
            }
            if (candidate.kind === "elseIf") {
                branches++;
                continue;
            }
            if (candidate.kind === "if") {
                break;
            }
        }

        return branches;
    }

    /**
     * Estimate per-case line counts for reporting detail.
     */
    private calculateCaseLineCounts(text: string): Array<{ label: string; lines: number }> {
        const lines = text.split(/\r?\n/);
        const result: Array<{ label: string; lines: number }> = [];

        let currentLabel: string | null = null;
        let startLineIdx = 0;

        const pushCase = (endIdx: number, isFinal: boolean) => {
            if (currentLabel === null) {
                return;
            }

            let trimmedEnd = endIdx;
            if (isFinal) {
                while (trimmedEnd > startLineIdx && /^[\s}]*$/.test(lines[trimmedEnd - 1])) {
                    trimmedEnd--;
                }
            }

            const count = Math.max(1, trimmedEnd - startLineIdx);
            result.push({ label: currentLabel, lines: count });
        };

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const caseMatch = line.match(/\bcase\s+([^:]+):/);
            const isDefault = /\bdefault\s*:/.test(line);

            if (caseMatch || isDefault) {
                pushCase(i, false);
                currentLabel = caseMatch ? caseMatch[1].trim() : "default";
                startLineIdx = i;
            }
        }

        pushCase(lines.length, true);

        return result;
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
