import { ArkMethod, Stmt } from "arkanalyzer";
import { ClassCategory } from "arkanalyzer/lib/core/model/ArkClass";

const UI_LIFECYCLE_METHODS = new Set([
    "aboutToAppear",
    "aboutToDisappear",
    "onPageShow",
    "onPageHide",
    "onBackPress"
]);

export function getMethodEndLine(method: ArkMethod): number {
    const startLine = method.getLine() ?? 0;
    const body = method.getBody();
    if (!body) {
        return startLine;
    }

    const stmts = body.getCfg().getStmts();
    let maxLine = startLine;
    for (const stmt of stmts) {
        const pos = stmt.getOriginPositionInfo();
        if (pos) {
            const line = pos.getLineNo();
            if (line > maxLine) {
                maxLine = line;
            }
        }
    }

    return maxLine;
}

export function shouldSkipClass(className: string): boolean {
    return className.startsWith("%");
}

export function shouldSkipMethod(methodName: string): boolean {
    return methodName === "constructor" || methodName.startsWith("%");
}

export function isArkUiMethod(method: ArkMethod): boolean {
    if (method.hasBuilderDecorator()) {
        return true;
    }

    if (method.hasViewTree()) {
        return true;
    }

    const declaringClass = method.getDeclaringArkClass();
    if (declaringClass && declaringClass.getCategory() === ClassCategory.STRUCT) {
        const methodName = method.getName();

        if (methodName === "build") {
            return true;
        }

        if (UI_LIFECYCLE_METHODS.has(methodName) && declaringClass.hasComponentDecorator()) {
            return true;
        }
    }

    return false;
}

export function isLogStatement(stmt: Stmt): boolean {
    const text = stmt.toString().trim();
    const logPattern = /^(console|hilog|Logger)\.\w+\s*\([\s\S]*\)$/i;
    return logPattern.test(text);
}
