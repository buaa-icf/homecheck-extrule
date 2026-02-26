import { ArkFile } from "arkanalyzer";
import { getMethodEndLine, isLogStatement } from "../shared";

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
    const logLines = collectLogLines(arkFile);
    if (logLines.size === 0) {
        return sourceCode;
    }

    const lines = sourceCode.split("\n");
    for (const lineNo of logLines) {
        const idx = lineNo - 1;
        if (idx >= 0 && idx < lines.length) {
            lines[idx] = "";
        }
    }

    return lines.join("\n");
}
