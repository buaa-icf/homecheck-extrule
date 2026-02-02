import { ArkMethod } from "arkanalyzer";
import { BaseChecker, BaseMetaData, CheckerUtils, Defects, IssueReport, MatcherCallback, MatcherTypes, MethodMatcher, Rule } from "homecheck";

// Heuristic detection for "Feature Envy" code smell: a method that tends to
// interact much more with another class than with its own.
const gMetaData: BaseMetaData = {
    severity: 2,
    ruleDocPath: "docs/feature-envy-check.md",
    description: "Method excessively uses members of another class (Feature Envy)."
};

export class FeatureEnvyCheck implements BaseChecker {
    readonly metaData: BaseMetaData = gMetaData;
    public rule: Rule;
    public issues: IssueReport[] = [];

    // Match every method.
    private methodMatcher: MethodMatcher = {
        matcherType: MatcherTypes.METHOD
    };

    // Minimum calls required to avoid noise.
    private readonly MIN_TOTAL_CALLS = 3;
    private readonly MIN_FOREIGN_CALLS = 3;
    private readonly RATIO_THRESHOLD = 0.6; // 60% or more calls to the same foreign class.

    public registerMatchers(): MatcherCallback[] {
        return [{ matcher: this.methodMatcher, callback: this.check }];
    }

    public check = (targetMtd: ArkMethod) => {
        const body = targetMtd.getBody();
        if (!body) {
            return;
        }

        const stmts = body.getCfg().getStmts();
        if (!stmts.length) {
            return;
        }

        const selfClass = targetMtd.getDeclaringClassSignature().getClassName();
        const callCountByClass = new Map<string, number>();
        let totalCalls = 0;

        for (const stmt of stmts) {
            const invoke = CheckerUtils.getInvokeExprFromStmt(stmt);
            if (!invoke) {
                continue;
            }

            const methodSign = invoke.getMethodSignature();
            const calleeClass = methodSign.getDeclaringClassSignature().getClassName();
            totalCalls++;
            callCountByClass.set(calleeClass, (callCountByClass.get(calleeClass) ?? 0) + 1);
        }

        if (totalCalls < this.MIN_TOTAL_CALLS) {
            return;
        }

        const selfCalls = callCountByClass.get(selfClass) ?? 0;
        let dominantClass = "";
        let dominantCalls = 0;
        for (const [cls, count] of callCountByClass) {
            if (cls === selfClass) {
                continue;
            }
            if (count > dominantCalls) {
                dominantCalls = count;
                dominantClass = cls;
            }
        }

        if (!dominantClass) {
            return;
        }

        const ratio = dominantCalls / totalCalls;
        const envyDetected = dominantCalls >= this.MIN_FOREIGN_CALLS && ratio >= this.RATIO_THRESHOLD && dominantCalls > selfCalls;
        if (!envyDetected) {
            return;
        }

        this.addIssueReport(targetMtd, dominantClass, dominantCalls, totalCalls, ratio);
    }

    private addIssueReport(method: ArkMethod, foreignClass: string, foreignCalls: number, totalCalls: number, ratio: number) {
        const severity = this.rule?.alert ?? this.metaData.severity;
        const line = method.getLine() ?? 0;
        const startCol = method.getColumn() ?? 0;
        const endCol = startCol + (method.getName()?.length ?? 0);
        const filePath = method.getDeclaringArkFile()?.getFilePath() ?? "";

        const methodName = method.getName() ?? "<unknown>";
        const description = `Method '${methodName}' is highly coupled to '${foreignClass}' (${foreignCalls}/${totalCalls} calls, ${(ratio * 100).toFixed(0)}%). Consider moving logic or introducing delegation.`;

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
            methodName,
            true
        );

        this.issues.push(new IssueReport(defects, undefined));
    }
}
