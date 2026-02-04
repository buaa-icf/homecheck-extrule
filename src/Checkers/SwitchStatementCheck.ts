import { ArkMethod, Stmt } from "arkanalyzer";
import { BaseChecker, BaseMetaData, Defects, IssueReport, MatcherCallback, MatcherTypes, MethodMatcher, Rule } from "homecheck";

// Detect "Switch Statement" smell: large switch blocks that may signal missing polymorphism.
const gMetaData: BaseMetaData = {
    severity: 2,
    ruleDocPath: "docs/switch-statement-check.md",
    description: "Large switch statement detected; consider replacing with polymorphism."
};

export class SwitchStatementCheck implements BaseChecker {
    readonly metaData: BaseMetaData = gMetaData;
    public rule: Rule;
    public issues: IssueReport[] = [];

    private methodMatcher: MethodMatcher = {
        matcherType: MatcherTypes.METHOD
    };

    private readonly MIN_CASES = 5; // Heuristic threshold for a "large" switch.

    public registerMatchers(): MatcherCallback[] {
        return [{ matcher: this.methodMatcher, callback: this.check }];
    }

    public check = (targetMtd: ArkMethod) => {
        const body = targetMtd.getBody();
        if (!body) {
            return;
        }

        const stmts = body.getCfg().getStmts();
        let hit = false;
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
                this.addIssueReport(targetMtd, stmt, caseCount, caseLineCounts);
                reported.add(this.buildSwitchKey(stmt.getOriginPositionInfo().getLineNo(), caseCount));
                hit = true;
            }
        }

        // Always run a source scan to catch switches missed/flattened in CFG; dedupe by key.
        this.detectFromSource(targetMtd, reported, hit);
    }

    private getStmtText(stmt: Stmt): string {
        return stmt.getOriginalText() ?? stmt.toString();
    }

    private containsSwitch(text: string): boolean {
        return /\bswitch\s*\(/.test(text);
    }

    private countCases(text: string): number {
        const matches = text.match(/\bcase\b|\bdefault\b/g);
        return matches ? matches.length : 0;
    }

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

    private detectFromSource(method: ArkMethod, reported: Set<string>, hadCfgHit: boolean) {
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
                    this.addIssueReportAtPosition(method, startLine + 1, col, caseCount, caseLineCounts);
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

    private buildSwitchKey(line: number, caseCount: number) {
        return `${line}-${caseCount}`;
    }

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

    private getCaseThreshold(): number {
        if (this.rule && this.rule.option && this.rule.option.length > 0) {
            const firstOption = this.rule.option[0] as any;
            if (typeof firstOption.minCases === "number") {
                return firstOption.minCases;
            }
        }
        return this.MIN_CASES;
    }

    private addIssueReport(method: ArkMethod, stmt: Stmt, caseCount: number, caseLineCounts: Array<{ label: string; lines: number }>) {
        const severity = this.rule?.alert ?? this.metaData.severity;
        const originPosition = stmt.getOriginPositionInfo();
        const line = originPosition.getLineNo();
        const startCol = originPosition.getColNo();
        const endCol = startCol + (stmt.getOriginalText()?.length ?? 0);
        const filePath = stmt.getCfg()?.getDeclaringMethod().getDeclaringArkFile()?.getFilePath() ?? "";
        const caseLineSummary = caseLineCounts.length > 0
            ? caseLineCounts.map(({ label, lines }) => `${label} (${lines} line${lines === 1 ? "" : "s"})`).join("; ")
            : "unavailable";

        const description = `Switch statement with ${caseCount} cases detected in method '${method.getName()}'. Consider using polymorphism or strategy. Case line counts: ${caseLineSummary}.`;

        const defects = new Defects(
            line,
            startCol,
            endCol,
            description,
            severity,
            this.rule.ruleId,
            filePath,
            this.metaData.ruleDocPath,
            true,
            false,
            false,
            method.getName(),
            true
        );

        this.issues.push(new IssueReport(defects, undefined));
    }

    private addIssueReportAtPosition(method: ArkMethod, line: number, startCol: number, caseCount: number, caseLineCounts: Array<{ label: string; lines: number }>) {
        const severity = this.rule?.alert ?? this.metaData.severity;
        const filePath = method.getDeclaringArkFile()?.getFilePath() ?? "";
        const caseLineSummary = caseLineCounts.length > 0
            ? caseLineCounts.map(({ label, lines }) => `${label} (${lines} line${lines === 1 ? "" : "s"})`).join("; ")
            : "unavailable";

        const description = `Switch statement with ${caseCount} cases detected in method '${method.getName()}'. Consider using polymorphism or strategy. Case line counts: ${caseLineSummary}.`;

        const defects = new Defects(
            line,
            startCol,
            startCol + 1,
            description,
            severity,
            this.rule.ruleId,
            filePath,
            this.metaData.ruleDocPath,
            true,
            false,
            false,
            method.getName(),
            true
        );

        this.issues.push(new IssueReport(defects, undefined));
    }
}
