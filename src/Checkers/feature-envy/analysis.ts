import { ArkMethod, Stmt } from "arkanalyzer";
import { CheckerUtils } from "homecheck";

const IGNORED_TYPE_ALIASES = new Set([
    "string", "number", "boolean", "object", "array", "date", "math", "regexp", "json", "symbol", "bigint", "error", "promise",
    "record", "map", "set", "weakmap", "weakset", "null", "undefined", "void"
]);

const DEFAULT_IGNORED_CLASSES = new Set<string>([
    "String", "Number", "Boolean", "Object", "Array", "Date", "Math", "RegExp", "JSON", "Symbol", "BigInt", "Error", "Promise",
    "Record", "Map", "Set", "WeakMap", "WeakSet"
]);

export interface FeatureEnvyMetrics {
    atfd: number;
    lda: number;
    cpfd: number;
    dominantProvider: string;
}

export interface FeatureEnvyAnalysisResult {
    metrics: FeatureEnvyMetrics;
    pureMappingAdapter: boolean;
}

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

type AssignStmtLike = Stmt & {
    getDef?: () => ValueLike;
    getRightOp?: () => ValueLike;
};

type TypeLike = {
    getClassSignature?: () => { getClassName?: () => string };
    getName?: () => string;
    getTypeString?: () => string;
} | null | undefined;

type InvokeLike = Exclude<ReturnType<typeof CheckerUtils.getInvokeExprFromStmt>, null | undefined> & {};

function getValueName(value: ValueLike): string {
    return value?.getName?.() ?? "";
}

function getInvokeText(invoke: InvokeLike): string {
    return typeof (invoke as { toString?: () => string }).toString === "function"
        ? invoke.toString()
        : String(invoke);
}

function incrementCount(counter: Map<string, number>, key: string): void {
    counter.set(key, (counter.get(key) ?? 0) + 1);
}

function getClassNameFromType(type: TypeLike): string {
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

function splitTopLevelTypeNames(typeName: string): string[] {
    const parts: string[] = [];
    let current = "";
    let angleDepth = 0;
    let parenDepth = 0;

    for (const char of typeName) {
        if (char === "<") {
            angleDepth++;
        } else if (char === ">" && angleDepth > 0) {
            angleDepth--;
        } else if (char === "(") {
            parenDepth++;
        } else if (char === ")" && parenDepth > 0) {
            parenDepth--;
        }

        if (char === "|" && angleDepth === 0 && parenDepth === 0) {
            const part = current.trim();
            if (part) {
                parts.push(part);
            }
            current = "";
            continue;
        }

        current += char;
    }

    const lastPart = current.trim();
    if (lastPart) {
        parts.push(lastPart);
    }

    return parts;
}

function unwrapTypeName(typeName: string): string {
    let normalized = typeName.trim();
    while (normalized.startsWith("(") && normalized.endsWith(")")) {
        normalized = normalized.slice(1, -1).trim();
    }
    return normalized;
}

function isIgnoredClassName(className: string, ignoredClasses: ReadonlySet<string>): boolean {
    if (!className) {
        return true;
    }

    const normalizedClassName = unwrapTypeName(className);
    const unionParts = splitTopLevelTypeNames(normalizedClassName);
    if (unionParts.length > 1) {
        return unionParts.every((part) => isIgnoredClassName(part, ignoredClasses));
    }

    const lowerClassName = normalizedClassName.toLowerCase();
    return normalizedClassName === "%unk"
        || normalizedClassName === "unknown"
        || normalizedClassName.startsWith("%")
        || ignoredClasses.has(normalizedClassName)
        || IGNORED_TYPE_ALIASES.has(lowerClassName);
}

export function buildFeatureEnvyFieldTypeMap(method: ArkMethod): Map<string, string> {
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
        fieldTypeMap.set(fieldName, getClassNameFromType(field.getType?.()));
    }

    return fieldTypeMap;
}

export class FeatureEnvyAnalyzer {
    constructor(
        private readonly selfClass: string,
        private readonly fieldTypeMap: Map<string, string>,
        private readonly ignoredClasses: ReadonlySet<string> = DEFAULT_IGNORED_CLASSES
    ) {}

    public analyze(stmts: Stmt[]): FeatureEnvyAnalysisResult {
        const metrics = this.collectMetrics(stmts);
        return {
            metrics,
            pureMappingAdapter: metrics.dominantProvider !== "" && this.isPureMappingAdapterMethod(stmts)
        };
    }

    private collectMetrics(stmts: Stmt[]): FeatureEnvyMetrics {
        let localDataAccesses = 0;
        let foreignDataAccesses = 0;
        const providerAccessCount = new Map<string, number>();

        for (const stmt of stmts) {
            const fieldAccess = this.classifyFieldAccess(stmt);
            if (fieldAccess.kind === "local") {
                localDataAccesses++;
            } else if (fieldAccess.kind === "foreign") {
                foreignDataAccesses++;
                incrementCount(providerAccessCount, fieldAccess.provider);
            }

            if (this.isLocalFieldWrite(stmt)) {
                localDataAccesses++;
            }

            for (const invoke of this.collectInvokes(stmt)) {
                const provider = this.resolveInvokeProvider(invoke);
                if (!this.isForeignProvider(provider)) {
                    continue;
                }

                foreignDataAccesses++;
                incrementCount(providerAccessCount, provider);
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

    private isPureMappingAdapterMethod(stmts: Stmt[]): boolean {
        let sourceProvider = "";
        let targetBase = "";
        let mappedTransfers = 0;

        for (let i = 0; i < stmts.length; i++) {
            const stmt = stmts[i];
            if (typeof stmt.isBranch === "function" && stmt.isBranch()) {
                return false;
            }

            const fieldAccess = this.classifyFieldAccess(stmt);
            if (fieldAccess.kind === "local" || this.isLocalFieldWrite(stmt)) {
                return false;
            }

            if (fieldAccess.kind !== "foreign") {
                continue;
            }

            if (!sourceProvider) {
                sourceProvider = fieldAccess.provider;
            } else if (sourceProvider !== fieldAccess.provider) {
                return false;
            }

            const transferValueName = getValueName((stmt as AssignStmtLike).getDef?.() as ValueLike);
            const mappedTargetBase = this.getMappedTargetBase(stmts[i + 1], transferValueName);
            if (!mappedTargetBase) {
                return false;
            }

            if (!targetBase) {
                targetBase = mappedTargetBase;
            } else if (targetBase !== mappedTargetBase) {
                return false;
            }

            mappedTransfers++;
        }

        if (!sourceProvider || !targetBase || mappedTransfers === 0) {
            return false;
        }

        const freshAliases = this.collectFreshLocalAliases(stmts, targetBase);
        if (freshAliases.size === 0) {
            return false;
        }

        let terminalInvokeCount = 0;
        for (const stmt of stmts) {
            for (const invoke of this.collectInvokes(stmt)) {
                const provider = this.resolveInvokeProvider(invoke);
                if (!this.isForeignProvider(provider)) {
                    continue;
                }

                const invokeBaseName = getValueName((invoke as { getBase?: () => ValueLike }).getBase?.());
                if (this.isConstructorInvoke(invoke) && freshAliases.has(invokeBaseName)) {
                    continue;
                }

                if (invokeBaseName === targetBase) {
                    terminalInvokeCount++;
                    continue;
                }

                return false;
            }
        }

        return terminalInvokeCount <= 1;
    }

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

    private collectInvokes(stmt: Stmt): InvokeLike[] {
        const invokes: InvokeLike[] = [];
        const seenKeys = new Set<string>();

        const tryAdd = (invoke: InvokeLike): void => {
            const key = getInvokeText(invoke);
            if (!seenKeys.has(key)) {
                seenKeys.add(key);
                invokes.push(invoke);
            }
        };

        const direct = CheckerUtils.getInvokeExprFromStmt(stmt);
        if (direct) {
            tryAdd(direct as InvokeLike);
        }

        if (typeof stmt.getExprs === "function") {
            for (const expr of stmt.getExprs() ?? []) {
                const exprObj = expr as { getInvokeExpr?: () => unknown } | null;
                if (exprObj && typeof exprObj.getInvokeExpr === "function") {
                    const invoke = exprObj.getInvokeExpr();
                    if (invoke) {
                        tryAdd(invoke as InvokeLike);
                    }
                }
            }
        }

        return invokes;
    }

    private classifyFieldAccess(stmt: Stmt): FieldAccessResult {
        if (typeof stmt.getFieldRef !== "function") {
            return { kind: "ignored" };
        }

        const fieldRef = stmt.getFieldRef() as FieldRefLike;
        if (!fieldRef) {
            return { kind: "ignored" };
        }

        const base = typeof fieldRef.getBase === "function" ? fieldRef.getBase() : null;
        const baseName = getValueName(base);
        const fieldName = typeof fieldRef.getFieldName === "function" ? fieldRef.getFieldName() : "";

        if (baseName === "this") {
            const fieldType = this.fieldTypeMap.get(fieldName) ?? "";
            if (fieldType && fieldType !== this.selfClass && !this.isIgnoredClass(fieldType)) {
                return { kind: "ignored" };
            }
            return { kind: "local" };
        }

        const provider = this.resolveProviderFromValue(base);
        if (!this.isForeignProvider(provider)) {
            return { kind: "ignored" };
        }

        return { kind: "foreign", provider };
    }

    private getMappedTargetBase(stmt: Stmt | undefined, expectedValueName: string): string {
        const assignStmt = stmt as AssignStmtLike | undefined;
        if (!assignStmt || !expectedValueName || typeof assignStmt.getDef !== "function" || typeof assignStmt.getRightOp !== "function") {
            return "";
        }

        const def = assignStmt.getDef() as FieldRefLike;
        if (!def || typeof def.getBase !== "function" || typeof def.getFieldName !== "function") {
            return "";
        }

        const baseName = getValueName(def.getBase?.());
        if (!baseName || baseName === "this") {
            return "";
        }

        const rightOpName = getValueName(assignStmt.getRightOp() as ValueLike);
        if (rightOpName !== expectedValueName) {
            return "";
        }

        return baseName;
    }

    private isLocalFieldWrite(stmt: Stmt): boolean {
        if (typeof stmt.getDef !== "function") {
            return false;
        }

        const def = stmt.getDef() as FieldRefLike;
        if (!def || typeof def.getBase !== "function" || typeof def.getFieldName !== "function") {
            return false;
        }

        return getValueName(def.getBase()) === "this" && this.fieldTypeMap.has(def.getFieldName());
    }

    private collectFreshLocalAliases(stmts: Stmt[], targetBase: string): Set<string> {
        const aliases = new Set<string>([targetBase]);
        let changed = true;

        while (changed) {
            changed = false;

            for (const stmt of stmts) {
                const assignStmt = stmt as AssignStmtLike;
                if (typeof assignStmt.getDef !== "function" || typeof assignStmt.getRightOp !== "function") {
                    continue;
                }

                const defName = getValueName(assignStmt.getDef() as ValueLike);
                if (!defName || !aliases.has(defName)) {
                    continue;
                }

                const rightName = getValueName(assignStmt.getRightOp() as ValueLike);
                if (rightName && !aliases.has(rightName)) {
                    aliases.add(rightName);
                    changed = true;
                }
            }
        }

        const freshAliases = new Set<string>();
        for (const stmt of stmts) {
            const defName = getValueName((stmt as AssignStmtLike).getDef?.() as ValueLike);
            if (!defName || !aliases.has(defName)) {
                continue;
            }

            const stmtText = stmt.toString?.() ?? "";
            if (stmtText.includes("= new ")) {
                freshAliases.add(defName);
            }
        }

        return freshAliases;
    }

    private isConstructorInvoke(invoke: InvokeLike): boolean {
        return getInvokeText(invoke).includes(".constructor()>");
    }

    private resolveInvokeProvider(invoke: InvokeLike): string {
        const methodSign = invoke.getMethodSignature();
        const signatureProvider = methodSign?.getDeclaringClassSignature?.().getClassName?.() ?? "";
        if (signatureProvider && signatureProvider !== "%unk" && !this.isIgnoredClass(signatureProvider)) {
            return signatureProvider;
        }

        const invokeObj = invoke as { getBase?: () => ValueLike };
        if (typeof invokeObj.getBase !== "function") {
            return "";
        }

        return this.resolveProviderFromValue(invokeObj.getBase());
    }

    private resolveProviderFromValue(
        value: ValueLike,
        seenValues: Set<unknown> = new Set()
    ): string {
        if (!value || seenValues.has(value)) {
            return "";
        }
        seenValues.add(value);

        const valueName = getValueName(value);
        if (valueName === "this") {
            return this.selfClass;
        }

        const typeClassName = getClassNameFromType(value.getType?.() as TypeLike);
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
        const fieldBaseName = getValueName(fieldBase);
        const fieldName = typeof fieldRef.getFieldName === "function" ? fieldRef.getFieldName() : "";
        if (fieldBaseName === "this") {
            return this.fieldTypeMap.get(fieldName) ?? "";
        }

        return this.resolveProviderFromValue(fieldBase, seenValues);
    }

    private isForeignProvider(provider: string): boolean {
        return provider !== "" && provider !== this.selfClass && !this.isIgnoredClass(provider);
    }

    private isIgnoredClass(className: string): boolean {
        return isIgnoredClassName(className, this.ignoredClasses);
    }
}
