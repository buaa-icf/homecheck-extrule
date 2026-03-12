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
import { BaseMetaData, CheckerUtils, MatcherCallback, MatcherTypes, MethodMatcher } from "homecheck";
import { RuleOptionSchema } from "./config/parseRuleOptions";
import { FeatureEnvyRuleOptions } from "./config/types";
import { BaseRuleChecker } from "./BaseRuleChecker";

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

interface FeatureEnvyMetrics {
    atfd: number;
    lda: number;
    cpfd: number;
    dominantProvider: string;
}

// Discriminated union for field access classification.
type FieldAccessResult =
    | { kind: "local" }
    | { kind: "foreign"; provider: string }
    | { kind: "ignored" };

type ValueLike = {
    getName?: () => string;
    getType?: () => unknown;
    getDeclaringStmt?: () => Stmt | null;
} | null | undefined;

type FieldRefLike = {
    getBase?: () => ValueLike;
    getFieldName?: () => string;
};

type TypeLike = {
    getClassSignature?: () => { getClassName?: () => string };
    getName?: () => string;
    getTypeString?: () => string;
} | null | undefined;

/**
 * Detects "Feature Envy" through ATFD/LDA/CPFD metrics recovered from CFG statements.
 */
export class FeatureEnvyCheck extends BaseRuleChecker<FeatureEnvyRuleOptions> {
    readonly metaData: BaseMetaData = gMetaData;

    protected readonly optionSchema = FEATURE_ENVY_OPTIONS_SCHEMA;
    protected readonly defaultOptions = DEFAULT_OPTIONS;

    // Ignore calls to built-in/native types to avoid false positives on literals/formatting.
    private readonly IGNORED_CLASSES = new Set<string>([
        "String", "Number", "Boolean", "Object", "Array", "Date", "Math", "RegExp", "JSON", "Symbol", "BigInt", "Error", "Promise",
        "Record", "Map", "Set", "WeakMap", "WeakSet"
    ]);

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
        const body = targetMtd.getBody();
        if (!body) {
            return;
        }

        const stmts = body.getCfg().getStmts();
        if (!stmts.length) {
            return;
        }

        const selfClass = targetMtd.getSignature().getDeclaringClassSignature().getClassName();
        const fieldTypeMap = this.buildFieldTypeMap(targetMtd);
        const metrics = this.collectMetrics(stmts, selfClass, fieldTypeMap);
        const { atfdThreshold, ldaThreshold, cpfdThreshold } = this.getOptions();

        if (!metrics.dominantProvider) {
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

    private collectMetrics(
        stmts: Stmt[],
        selfClass: string,
        fieldTypeMap: Map<string, string>
    ): FeatureEnvyMetrics {
        let localDataAccesses = 0;
        let foreignDataAccesses = 0;
        const providerAccessCount = new Map<string, number>();

        for (const stmt of stmts) {
            const fieldAccess = this.classifyFieldAccess(stmt, selfClass, fieldTypeMap);
            if (fieldAccess.kind === "local") {
                localDataAccesses++;
            } else if (fieldAccess.kind === "foreign") {
                foreignDataAccesses++;
                providerAccessCount.set(
                    fieldAccess.provider,
                    (providerAccessCount.get(fieldAccess.provider) ?? 0) + 1
                );
            }

            for (const invoke of this.collectInvokes(stmt)) {
                const provider = this.resolveInvokeProvider(invoke, selfClass, fieldTypeMap);
                if (!provider || provider === selfClass || this.isIgnoredClass(provider)) {
                    continue;
                }
                foreignDataAccesses++;
                providerAccessCount.set(provider, (providerAccessCount.get(provider) ?? 0) + 1);
            }
        }

        const totalDataAccesses = localDataAccesses + foreignDataAccesses;
        return {
            atfd: foreignDataAccesses,
            lda: totalDataAccesses === 0 ? 1 : localDataAccesses / totalDataAccesses,
            cpfd: providerAccessCount.size,
            dominantProvider: this.findDominantProvider(providerAccessCount),
        };
    }

    /**
     * Return the provider class name with the highest access count, or "" if empty.
     */
    private findDominantProvider(providerAccessCount: Map<string, number>): string {
        let dominantProvider = "";
        let dominantCount = 0;
        for (const [provider, count] of providerAccessCount) {
            if (count > dominantCount) {
                dominantProvider = provider;
                dominantCount = count;
            }
        }
        return dominantProvider;
    }

    /**
     * Collect invoke expressions from a statement (best-effort across stmt/expr shapes).
     * Deduplicates by toString() key inline.
     */
    private collectInvokes(stmt: Stmt) {
        const invokes: Array<ReturnType<typeof CheckerUtils.getInvokeExprFromStmt> & {}> = [];
        const seenKeys = new Set<string>();

        const tryAdd = (invoke: typeof invokes[number]) => {
            const key = typeof (invoke as { toString?: () => string }).toString === "function"
                ? invoke.toString()
                : String(invoke);
            if (!seenKeys.has(key)) {
                seenKeys.add(key);
                invokes.push(invoke);
            }
        };

        const direct = CheckerUtils.getInvokeExprFromStmt(stmt);
        if (direct) {
            tryAdd(direct);
        }

        if (typeof stmt.getExprs === "function") {
            for (const expr of stmt.getExprs() ?? []) {
                // Best-effort: some expr nodes may expose getInvokeExpr.
                const exprObj = expr as { getInvokeExpr?: () => unknown } | null;
                if (exprObj && typeof exprObj.getInvokeExpr === "function") {
                    const inv = exprObj.getInvokeExpr();
                    if (inv) {
                        tryAdd(inv as typeof invokes[number]);
                    }
                }
            }
        }

        return invokes;
    }

    private classifyFieldAccess(
        stmt: Stmt,
        selfClass: string,
        fieldTypeMap: Map<string, string>
    ): FieldAccessResult {
        if (typeof stmt.getFieldRef !== "function") {
            return { kind: "ignored" };
        }

        const fieldRef = stmt.getFieldRef() as FieldRefLike;
        if (!fieldRef) {
            return { kind: "ignored" };
        }

        const base = typeof fieldRef.getBase === "function" ? fieldRef.getBase() : null;
        const baseName = base?.getName?.() ?? "";
        const fieldName = typeof fieldRef.getFieldName === "function" ? fieldRef.getFieldName() : "";

        if (baseName === "this") {
            const fieldType = fieldTypeMap.get(fieldName) ?? "";
            if (fieldType && fieldType !== selfClass && !this.isIgnoredClass(fieldType)) {
                return { kind: "ignored" };
            }
            return { kind: "local" };
        }

        const provider = this.resolveProviderFromValue(base, selfClass, fieldTypeMap);
        if (!provider || provider === selfClass || this.isIgnoredClass(provider)) {
            return { kind: "ignored" };
        }

        return { kind: "foreign", provider };
    }

    private resolveInvokeProvider(
        invoke: ReturnType<typeof CheckerUtils.getInvokeExprFromStmt> & {},
        selfClass: string,
        fieldTypeMap: Map<string, string>
    ): string {
        const methodSign = invoke.getMethodSignature();
        const signatureProvider = methodSign?.getDeclaringClassSignature?.().getClassName?.() ?? "";
        if (signatureProvider && signatureProvider !== "%unk" && !this.isIgnoredClass(signatureProvider)) {
            return signatureProvider;
        }

        const invokeObj = invoke as { getBase?: () => ValueLike };
        if (typeof invokeObj.getBase !== "function") {
            return "";
        }

        return this.resolveProviderFromValue(invokeObj.getBase(), selfClass, fieldTypeMap);
    }

    private resolveProviderFromValue(
        value: ValueLike,
        selfClass: string,
        fieldTypeMap: Map<string, string>,
        seenValues: Set<unknown> = new Set()
    ): string {
        if (!value || seenValues.has(value)) {
            return "";
        }
        seenValues.add(value);

        const valueName = value.getName?.() ?? "";
        if (valueName === "this") {
            return selfClass;
        }

        const typeClassName = this.getClassNameFromType(value.getType?.() as TypeLike);
        if (typeClassName && typeClassName !== "unknown") {
            return typeClassName;
        }

        const declaringStmt = value.getDeclaringStmt?.() ?? null;
        if (!declaringStmt || typeof declaringStmt.getFieldRef !== "function") {
            return "";
        }

        const fieldRef = declaringStmt.getFieldRef() as FieldRefLike;
        if (!fieldRef) {
            return "";
        }

        const fieldBase = typeof fieldRef.getBase === "function" ? fieldRef.getBase() : null;
        const fieldBaseName = fieldBase?.getName?.() ?? "";
        const fieldName = typeof fieldRef.getFieldName === "function" ? fieldRef.getFieldName() : "";
        if (fieldBaseName === "this") {
            return fieldTypeMap.get(fieldName) ?? "";
        }

        return this.resolveProviderFromValue(
            fieldBase,
            selfClass,
            fieldTypeMap,
            seenValues
        );
    }

    private buildFieldTypeMap(method: ArkMethod): Map<string, string> {
        const fieldTypeMap = new Map<string, string>();
        const declaringClass = method.getDeclaringArkClass();
        if (!declaringClass) {
            return fieldTypeMap;
        }

        for (const field of declaringClass.getFields()) {
            const fieldName = field.getName?.() ?? "";
            if (!fieldName) {
                continue;
            }
            fieldTypeMap.set(fieldName, this.getClassNameFromType(field.getType?.()));
        }

        return fieldTypeMap;
    }

    private getClassNameFromType(type: TypeLike): string {
        if (!type) {
            return "";
        }

        const className = type.getClassSignature?.().getClassName?.() ?? "";
        if (className) {
            return className;
        }

        const unclearName = type.getName?.() ?? "";
        if (unclearName) {
            return unclearName;
        }

        return type.getTypeString?.() ?? "";
    }

    /**
     * Filter out common built-in types to reduce noise.
     */
    private isIgnoredClass(className: string): boolean {
        return !className
            || className === "%unk"
            || className === "unknown"
            || this.IGNORED_CLASSES.has(className);
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
