import { ArkMethod } from "arkanalyzer";
import { BaseChecker, BaseMetaData, CheckerUtils, IssueReport, MatcherCallback, MatcherTypes, MethodMatcher, Rule } from "homecheck";
import { createDefects, getRuleOption } from "./utils";

// Heuristic detection for "Feature Envy" code smell: a method that tends to
// interact much more with another class than with its own.
const gMetaData: BaseMetaData = {
    severity: 2,
    ruleDocPath: "docs/feature-envy-check.md",
    description: "Method excessively uses members of another class (Feature Envy)."
};

/**
 * Detects "Feature Envy" by comparing call distribution to self vs. foreign classes.
 * Thresholds can be tuned via rule.option[0] (minTotalCalls, minForeignCalls, ratioThreshold).
 */
export class FeatureEnvyCheck implements BaseChecker {
    readonly metaData: BaseMetaData = gMetaData;
    public rule: Rule;
    public issues: IssueReport[] = [];

    // Ignore calls to built-in/native types to avoid false positives on literals/formatting.
    private readonly IGNORED_CLASSES = new Set<string>([
        "String", "Number", "Boolean", "Object", "Array", "Date", "Math", "RegExp", "JSON", "Symbol", "BigInt", "Error", "Promise"
    ]);

    // Match every method.
    private methodMatcher: MethodMatcher = {
        matcherType: MatcherTypes.METHOD
    };

    // Default thresholds to avoid noise; can be overridden via rule.option[0].
    private readonly MIN_TOTAL_CALLS = 3;
    private readonly MIN_FOREIGN_CALLS = 3;
    private readonly RATIO_THRESHOLD = 0.6; // 60% or more calls to the same foreign class.

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
        const body = targetMtd.getBody();
        if (!body) {
            return;
        }

        const stmts = body.getCfg().getStmts();
        if (!stmts.length) {
            return;
        }

        const selfClass = targetMtd.getSignature().getDeclaringClassSignature().getClassName();
        const callCountByClass = new Map<string, number>();
        let totalCalls = 0;

        const { minTotalCalls, minForeignCalls, ratioThreshold } = this.getThresholds();

        for (const stmt of stmts) {
            const invokes = this.collectInvokes(stmt);
            if (!invokes.length) {
                continue;
            }

            for (const invoke of invokes) {
                const methodSign = invoke.getMethodSignature();
                const calleeClass = methodSign.getDeclaringClassSignature().getClassName();
                if (!calleeClass || this.isIgnoredClass(calleeClass)) {
                    continue;
                }
                totalCalls++;
                callCountByClass.set(calleeClass, (callCountByClass.get(calleeClass) ?? 0) + 1);
            }
        }

        if (totalCalls < minTotalCalls) {
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
        const envyDetected = dominantCalls >= minForeignCalls && ratio >= ratioThreshold && dominantCalls > selfCalls;
        if (!envyDetected) {
            return;
        }

        this.addIssueReport(targetMtd, dominantClass, dominantCalls, totalCalls, ratio);
    }

    /**
     * Resolve thresholds, falling back to defaults if rule options are missing.
     */
    private getThresholds() {
        return getRuleOption(this.rule, {
            minTotalCalls: this.MIN_TOTAL_CALLS,
            minForeignCalls: this.MIN_FOREIGN_CALLS,
            ratioThreshold: this.RATIO_THRESHOLD
        });
    }

    /**
     * Collect invoke expressions from a statement (best-effort across stmt/expr shapes).
     */
    private collectInvokes(stmt: any) {
        const invokes: any[] = [];

        const direct = CheckerUtils.getInvokeExprFromStmt(stmt);
        if (direct) {
            invokes.push(direct);
        }

        if (typeof stmt.getExprs === "function") {
            for (const expr of stmt.getExprs() ?? []) {
                // Best-effort: some expr nodes may expose getInvokeExpr.
                if (expr && typeof (expr as any).getInvokeExpr === "function") {
                    const inv = (expr as any).getInvokeExpr();
                    if (inv) {
                        invokes.push(inv);
                    }
                }
            }
        }

        return invokes;
    }

    /**
     * Filter out common built-in types to reduce noise.
     */
    private isIgnoredClass(className: string): boolean {
        return this.IGNORED_CLASSES.has(className);
    }

    /**
     * Emit an IssueReport describing the detected Feature Envy.
     */
    private addIssueReport(method: ArkMethod, foreignClass: string, foreignCalls: number, totalCalls: number, ratio: number) {
        const severity = this.rule?.alert ?? this.metaData.severity;
        const line = method.getLine() ?? 0;
        const startCol = method.getColumn() ?? 0;
        const endCol = startCol + (method.getName()?.length ?? 0);
        const filePath = method.getDeclaringArkFile()?.getFilePath() ?? "";

        const methodName = method.getName() ?? "<unknown>";
        const description = `Method '${methodName}' is highly coupled to '${foreignClass}' (${foreignCalls}/${totalCalls} calls, ${(ratio * 100).toFixed(0)}%). Consider moving logic or introducing delegation.`;

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
