import { ArkMethod, Stmt } from "arkanalyzer";
import { BaseChecker, BaseMetaData, IssueReport, MatcherCallback, MatcherTypes, MethodMatcher, Rule } from "homecheck";
import { createDefects, getRuleOption } from "./utils";

// Detect "Switch Statement" smell: large switch blocks that may signal missing polymorphism.
const gMetaData: BaseMetaData = {
    severity: 2,
    ruleDocPath: "docs/switch-statement-check.md",
    description: "Large switch statement detected; consider replacing with polymorphism."
};

/**
 * Detects large switch statements by counting case/default labels.
 * Uses CFG statements for structure and a source scan as a fallback.
 */
export class SwitchStatementCheck implements BaseChecker {
    readonly metaData: BaseMetaData = gMetaData;
    public rule: Rule;
    public issues: IssueReport[] = [];

    private methodMatcher: MethodMatcher = {
        matcherType: MatcherTypes.METHOD
    };

    private readonly MIN_CASES = 5; // Heuristic threshold for a "large" switch.

    /**
     * Register the method-level matcher for this checker.
     */
    public registerMatchers(): MatcherCallback[] {
        return [{ matcher: this.methodMatcher, callback: this.check }];
    }

    /**
     * Scan a method for switch blocks and report those above the threshold.
     */
    public check = (targetMtd: ArkMethod) => {
        const body = targetMtd.getBody();
        if (!body) {
            return;
        }

        const stmts = body.getCfg().getStmts();
        const reported = new Set<string>();
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
                    this.addIssueReport(
                        targetMtd,
                        caseCount,
                        caseLineCounts,
                        originPosition.getLineNo(),
                        originPosition.getColNo(),
                        originPosition.getColNo() + (stmt.getOriginalText()?.length ?? 0),
                        stmt.getCfg()?.getDeclaringMethod().getDeclaringArkFile()?.getFilePath() ?? ""
                    );
                    reported.add(this.buildSwitchKey(stmt.getOriginPositionInfo().getLineNo(), caseCount));
                }
            }

        // Always run a source scan to catch switches missed/flattened in CFG; dedupe by key.
        this.detectFromSource(targetMtd, reported);
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
    private detectFromSource(method: ArkMethod, reported: Set<string>) {
        const code = method.getCode();
        if (!code) {
            return;
        }

        const lines = code.split(/\r?\n/);
        const threshold = this.getCaseThreshold();

        let inSwitch = false;
        let braceDepth = 0;
        let blockLines: string[] = [];
        let startLine = 0;

        const flush = () => {
            if (!blockLines.length) {
                return;
            }
            const blockText = blockLines.join("\n");
            const caseCount = this.countCases(blockText);
            if (caseCount >= threshold) {
                const caseLineCounts = this.calculateCaseLineCounts(blockText);
                // Columns are best-effort; we align to start of switch line.
                const col = (lines[startLine].indexOf("switch") >= 0) ? lines[startLine].indexOf("switch") : 0;
                const key = this.buildSwitchKey(startLine + 1, caseCount);
                if (!reported.has(key)) {
                    this.addIssueReport(
                        method,
                        caseCount,
                        caseLineCounts,
                        startLine + 1,
                        col,
                        col + 1,
                        method.getDeclaringArkFile()?.getFilePath() ?? ""
                    );
                    reported.add(key);
                }
            }
        };

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
                flush();
                inSwitch = false;
                blockLines = [];
            }
        }

        // Handle unterminated block (best-effort)
        if (inSwitch) {
            flush();
        }

        // If neither CFG nor source caught anything, do nothing further; we attempted best-effort paths.
    }

    /**
     * Create a stable-ish dedupe key for a detected switch block.
     */
    private buildSwitchKey(line: number, caseCount: number) {
        return `${line}-${caseCount}`;
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
        const option = getRuleOption(this.rule, { minCases: this.MIN_CASES });
        return option.minCases;
    }

    /**
     * Report a switch statement detected from CFG statement context.
     */
    private addIssueReport(
        method: ArkMethod,
        caseCount: number,
        caseLineCounts: Array<{ label: string; lines: number }>,
        line: number,
        startCol: number,
        endCol: number,
        filePath: string
    ) {
        const severity = this.rule?.alert ?? this.metaData.severity;
        const caseLineSummary = caseLineCounts.length > 0
            ? caseLineCounts.map(({ label, lines }) => `${label} (${lines} line${lines === 1 ? "" : "s"})`).join("; ")
            : "unavailable";

        const description = `Switch statement with ${caseCount} cases detected in method '${method.getName()}'. Consider using polymorphism or strategy. Case line counts: ${caseLineSummary}.`;

        this.issues.push(createDefects({
            line,
            startCol,
            endCol,
            description,
            severity,
            ruleId: this.rule.ruleId,
            filePath,
            ruleDocPath: this.metaData.ruleDocPath,
            methodName: method.getName()
        }));
    }
}
