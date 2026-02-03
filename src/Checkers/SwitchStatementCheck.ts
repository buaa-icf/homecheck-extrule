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
        for (const stmt of stmts) {
            const text = stmt.getOriginalText() ?? stmt.toString();
            if (!this.containsSwitch(text)) {
                continue;
            }

            const caseCount = this.countCases(text);
            if (caseCount >= this.getCaseThreshold()) {
                const caseLineCounts = this.calculateCaseLineCounts(text);
                this.addIssueReport(targetMtd, stmt, caseCount, caseLineCounts);
            }
        }
    }

    private containsSwitch(text: string): boolean {
        return /\bswitch\s*\(/.test(text);
    }

    private countCases(text: string): number {
        const matches = text.match(/\bcase\b/g);
        return matches ? matches.length : 0;
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
}
