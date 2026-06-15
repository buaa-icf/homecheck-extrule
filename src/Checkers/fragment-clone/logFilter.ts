import { ArkFile } from "arkanalyzer";
import { getMethodEndLine, isLogStatement } from "../shared";

const LOG_STATEMENT_PREFIX_PATTERN = /\b(?:console|hilog|logger)\./i;

export function collectLogLines(arkFile: ArkFile): Set<number> {
    const logLines = new Set<number>();

    for (const arkClass of arkFile.getClasses()) {
        for (const method of arkClass.getMethods()) {
            const body = method.getBody();
            if (!body) {
                continue;
            }

            const stmts = body.getCfg().getStmts();
            if (stmts.length === 0) {
                continue;
            }

            const methodEndLine = getMethodEndLine(method);

            for (let i = 0; i < stmts.length; i++) {
                if (!isLogStatement(stmts[i])) {
                    continue;
                }

                const startLine = stmts[i].getOriginPositionInfo().getLineNo();
                if (startLine <= 0) {
                    continue;
                }

                let endLine: number;
                if (i + 1 < stmts.length) {
                    const nextLine = stmts[i + 1].getOriginPositionInfo().getLineNo();
                    endLine = nextLine > startLine ? nextLine - 1 : startLine;
                } else {
                    endLine = methodEndLine;
                }

                for (let line = startLine; line <= endLine; line++) {
                    logLines.add(line);
                }
            }
        }
    }

    return logLines;
}

export function removeLogLines(sourceCode: string, arkFile: ArkFile): string {
    if (!mayContainLogStatementPrefix(sourceCode)) {
        return sourceCode;
    }

    const logLines = collectLogLines(arkFile);
    if (logLines.size === 0) {
        return sourceCode;
    }

    return blankSourceLines(sourceCode, logLines);
}

function mayContainLogStatementPrefix(sourceCode: string): boolean {
    return LOG_STATEMENT_PREFIX_PATTERN.test(sourceCode);
}

export function blankSourceLines(sourceCode: string, lineNumbers: Iterable<number>): string {
    const targets = normalizeLineNumbers(lineNumbers);
    if (targets.length === 0) {
        return sourceCode;
    }

    const parts: string[] = [];
    let copyStart = 0;
    let lineStart = 0;
    let lineNo = 1;
    let targetIndex = 0;

    for (let i = 0; i < sourceCode.length && targetIndex < targets.length;) {
        const charCode = sourceCode.charCodeAt(i);
        if (charCode !== 10 && charCode !== 13) {
            i++;
            continue;
        }

        while (targetIndex < targets.length && targets[targetIndex] < lineNo) {
            targetIndex++;
        }

        const newlineStart = i;
        const newlineEnd = charCode === 13 && sourceCode.charCodeAt(i + 1) === 10 ? i + 2 : i + 1;

        if (targets[targetIndex] === lineNo) {
            parts.push(sourceCode.slice(copyStart, lineStart));
            parts.push(sourceCode.slice(newlineStart, newlineEnd));
            copyStart = newlineEnd;

            while (targetIndex < targets.length && targets[targetIndex] === lineNo) {
                targetIndex++;
            }
        }

        i = newlineEnd;
        lineNo++;
        lineStart = i;
    }

    while (targetIndex < targets.length && targets[targetIndex] < lineNo) {
        targetIndex++;
    }

    if (targetIndex < targets.length && targets[targetIndex] === lineNo) {
        parts.push(sourceCode.slice(copyStart, lineStart));
        copyStart = sourceCode.length;
    }

    if (parts.length === 0) {
        return sourceCode;
    }

    parts.push(sourceCode.slice(copyStart));
    return parts.join("");
}

function normalizeLineNumbers(lineNumbers: Iterable<number>): number[] {
    return [...new Set(lineNumbers)]
        .filter(lineNo => Number.isInteger(lineNo) && lineNo > 0)
        .sort((a, b) => a - b);
}
